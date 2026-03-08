import { create } from 'zustand'
import { authApi, type UserMe } from './api'
import { keyStore } from './crypto/keyStore'
import { deriveKeysInWorker } from './crypto/keys'
import { SRPClient } from './crypto/srp'
import { parseSecretKey } from './crypto/secretKey'
import { assertWebCryptoAvailable } from './crypto/registration'
import { getAuthErrorMessage } from './errors'

interface AuthState {
  user: UserMe | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  needsSecretKey: boolean // True when SRP user on new device needs Secret Key
  isDerivingKeys: boolean // True during PBKDF2 computation
  isUpgrading: boolean // True when legacy bcrypt user is upgrading to SRP
  pendingUpgradeEmail: string | null // Email of user being upgraded
  pendingUpgradePassword: string | null // Password of user being upgraded (for SRP derivation)

  login: (email: string, password: string) => Promise<void>
  srpLogin: (email: string, password: string, secretKeyInput?: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  clearError: () => void
  clearNeedsSecretKey: () => void
  completeUpgrade: () => Promise<void>
  cancelUpgrade: () => void
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  needsSecretKey: false,
  isDerivingKeys: false,
  isUpgrading: false,
  pendingUpgradeEmail: null,
  pendingUpgradePassword: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const result = await authApi.login({ email, password })

      // Check if this is a legacy bcrypt user needing SRP upgrade
      if (result.auth_upgrade_required) {
        // Only show upgrade dialog if Web Crypto is available (requires HTTPS or localhost).
        // If not, skip upgrade and proceed with bcrypt session — upgrade happens next HTTPS visit.
        const hasCrypto = typeof crypto !== 'undefined' && !!crypto.subtle
        if (hasCrypto) {
          set({
            isLoading: false,
            isUpgrading: true,
            pendingUpgradeEmail: email,
            pendingUpgradePassword: password,
          })
          return
        }
        // Fall through to complete login without SRP upgrade
      }

      const user = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false, error: null })
    } catch (err: unknown) {
      // Check if 409 srp_required -- redirect to SRP flow
      const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
      if (
        axiosErr?.response?.status === 409 &&
        axiosErr?.response?.data?.detail === 'srp_required'
      ) {
        // User has SRP auth -- try SRP flow
        return get().srpLogin(email, password)
      }
      const message = getAuthErrorMessage(err)
      set({
        isLoading: false,
        isAuthenticated: false,
        user: null,
        error: message,
      })
      throw new Error(message)
    }
  },

  srpLogin: async (email: string, password: string, secretKeyInput?: string) => {
    set({ isLoading: true, isDerivingKeys: true, error: null })

    try {
      // 0. Verify Web Crypto API is available (requires HTTPS or localhost)
      assertWebCryptoAvailable()

      // 1. Get Secret Key (from IndexedDB or user input)
      let secretKeyBytes: Uint8Array | null = await keyStore.getSecretKey(email)
      if (!secretKeyBytes && secretKeyInput) {
        secretKeyBytes = parseSecretKey(secretKeyInput)
        if (!secretKeyBytes) {
          set({ error: 'Invalid Secret Key format', isLoading: false, isDerivingKeys: false })
          return
        }
      }
      if (!secretKeyBytes) {
        set({ needsSecretKey: true, isLoading: false, isDerivingKeys: false })
        return
      }

      // 2. SRP Step 1: init (returns salt, B, session_id, AND key derivation salts)
      const { salt, server_public, session_id, pbkdf2_salt, hkdf_salt } =
        await authApi.srpInit(email)

      // 3. Decode base64 salts returned by /srp/init from user_key_sets
      const pbkdf2SaltBytes = Uint8Array.from(atob(pbkdf2_salt), (c) => c.charCodeAt(0))
      const hkdfSaltBytes = Uint8Array.from(atob(hkdf_salt), (c) => c.charCodeAt(0))

      // 4. Derive keys in Web Worker (PBKDF2 650K iterations)
      const { auk, srpX } = await deriveKeysInWorker({
        masterPassword: password,
        secretKeyBytes,
        email,
        accountId: email, // Use email as accountId for key derivation
        pbkdf2Salt: pbkdf2SaltBytes,
        hkdfSalt: hkdfSaltBytes,
      })

      set({ isDerivingKeys: false })

      // 5. SRP handshake
      const srpClient = new SRPClient(email)
      const { clientProof } = await srpClient.computeSession(srpX, salt, server_public)

      // 6. SRP Step 2: verify
      const result = await authApi.srpVerify({
        email,
        session_id,
        client_public: srpClient.getPublicEphemeral(),
        client_proof: clientProof,
      })

      // 7. Verify server proof M2
      const serverValid = await srpClient.verifyServerProof(result.server_proof)
      if (!serverValid) {
        throw new Error('Server authentication failed')
      }

      // 8. Store AUK and unlock key set
      keyStore.setAUK(auk)
      // TODO (Phase 30): Decrypt encrypted_key_set with AUK to get vault key

      // 9. Store Secret Key in IndexedDB for future logins on this device
      await keyStore.storeSecretKey(email, secretKeyBytes)

      // 10. Fetch user profile
      const user = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false, needsSecretKey: false })
    } catch (err) {
      keyStore.clearAll()
      const axErr = err as { response?: { status?: number; data?: { detail?: string } } }
      const detail = axErr?.response?.data?.detail ?? ''
      let message: string
      if (axErr?.response?.status === 401) {
        // SRP proof failed — wrong password, wrong Secret Key, or stale credentials
        message = 'Sign in failed. Check your password and Secret Key. If you lost your Secret Key, use "Forgot password?" to reset your account and get a new one.'
      } else if (detail.includes('initialization failed')) {
        message = 'Authentication setup failed. Please try again or reset your password.'
      } else {
        message = getAuthErrorMessage(err)
      }
      set({ isLoading: false, isDerivingKeys: false, error: message })
      throw err
    }
  },

  completeUpgrade: async () => {
    // Called after SRP registration completes during upgrade flow.
    // The user already has a valid session cookie from the bcrypt login,
    // so just fetch the profile to complete authentication. A full SRP
    // login will happen naturally on their next session.
    set({ isUpgrading: false, pendingUpgradeEmail: null, pendingUpgradePassword: null })

    try {
      const user = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false, error: null })
    } catch (err) {
      set({ isLoading: false, error: getAuthErrorMessage(err) })
      throw err
    }
  },

  cancelUpgrade: () => {
    set({
      isUpgrading: false,
      pendingUpgradeEmail: null,
      pendingUpgradePassword: null,
      isLoading: false,
    })
  },

  logout: async () => {
    keyStore.clearAll()
    set({ isLoading: true })
    try {
      await authApi.logout()
    } catch {
      // ignore logout errors
    } finally {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        needsSecretKey: false,
        isDerivingKeys: false,
        isUpgrading: false,
        pendingUpgradeEmail: null,
        pendingUpgradePassword: null,
      })
    }
  },

  checkAuth: async () => {
    set({ isLoading: true })
    try {
      const user = await authApi.me()
      set({ user, isAuthenticated: true, isLoading: false, error: null })
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false, error: null })
    }
  },

  clearError: () => set({ error: null }),
  clearNeedsSecretKey: () => set({ needsSecretKey: false }),
}))

// Role helpers
export function isSuperAdmin(user: UserMe | null): boolean {
  return user?.role === 'super_admin'
}

export function isTenantAdmin(user: UserMe | null): boolean {
  return user?.role === 'tenant_admin' || user?.role === 'super_admin'
}

export function isOperator(user: UserMe | null): boolean {
  return (
    user?.role === 'operator' ||
    user?.role === 'tenant_admin' ||
    user?.role === 'super_admin'
  )
}

export function canWrite(user: UserMe | null): boolean {
  return isOperator(user)
}

export function canDelete(user: UserMe | null): boolean {
  return isTenantAdmin(user)
}
