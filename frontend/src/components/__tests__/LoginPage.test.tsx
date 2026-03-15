/**
 * LoginPage component tests -- verifies form rendering, credential submission,
 * error display, and loading state for the login flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

// Mock useNavigate from TanStack Router
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => ({
    component: undefined,
  }),
  useNavigate: () => mockNavigate,
}))

// Mock useAuth zustand store -- track login/clearError calls
const mockLogin = vi.fn()
const mockClearError = vi.fn()
let authState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null as string | null,
  login: mockLogin,
  logout: vi.fn(),
  checkAuth: vi.fn(),
  clearError: mockClearError,
}

// useAuth needs a .getState() static method because login.tsx calls useAuth.getState()
// after login to check isUpgrading/needsSecretKey before navigating.
const useAuthMock = Object.assign(() => authState, {
  getState: () => ({ isUpgrading: false, needsSecretKey: false }),
})

vi.mock('@/lib/auth', () => ({
  useAuth: useAuthMock,
}))

// --------------------------------------------------------------------------
// Import after mocks
// --------------------------------------------------------------------------
// We need to import LoginPage from the route file. Since createFileRoute is
// mocked, we import the default export which is the page component.
// The file exports Route (from createFileRoute) and has LoginPage as the
// component. We re-export it via a manual approach.

// Since the login page defines LoginPage as a function inside the module and
// assigns it to Route.component, we need a different approach. Let's import
// the module and extract the component from the Route object.

// Actually, with our mock of createFileRoute returning an object, the Route
// export won't have the component. Let's mock createFileRoute to capture it.

let CapturedComponent: React.ComponentType | undefined

vi.mock('@tanstack/react-router', async () => {
  return {
    createFileRoute: () => ({
      // The real createFileRoute('/login')({component: LoginPage}) returns
      // an object. Our mock captures the component from the call.
      __call: true,
    }),
    useNavigate: () => mockNavigate,
  }
})

// We need a different strategy. Let's directly create the LoginPage component
// inline here since the route file couples createFileRoute with the component.
// This is a common pattern for testing file-based route components.

// Instead, let's build a simplified LoginPage that matches the real one's
// behavior and test that. OR, we mock createFileRoute properly.

// Best approach: mock createFileRoute to return a function that captures the
// component option.
vi.mock('@tanstack/react-router', () => {
  return {
    createFileRoute: () => (opts: { component: React.ComponentType }) => {
      CapturedComponent = opts.component
      return { component: opts.component }
    },
    useNavigate: () => mockNavigate,
    Link: ({ children, ...props }: { children: React.ReactNode; to?: string }) => (
      <a href={props.to ?? '#'}>{children}</a>
    ),
  }
})

// Now importing the login module will call createFileRoute('/login')({component: LoginPage})
// and CapturedComponent will be set to LoginPage.

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('LoginPage', () => {
  let LoginPage: React.ComponentType

  beforeEach(async () => {
    vi.clearAllMocks()
    CapturedComponent = undefined

    // Reset auth state
    authState = {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      login: mockLogin,
      logout: vi.fn(),
      checkAuth: vi.fn(),
      clearError: mockClearError,
    }

    // Dynamic import to re-trigger module evaluation
    // Use cache-busting to force re-evaluation
    const mod = await import('@/routes/login')
    // The component is set via our mock
    if (CapturedComponent) {
      LoginPage = CapturedComponent
    } else {
      // Fallback: try to get it from the Route export
      LoginPage = (mod.Route as { component?: React.ComponentType })?.component ?? (() => null)
    }
  })

  it('renders login form with email and password fields', () => {
    render(<LoginPage />)

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('renders branding elements', () => {
    render(<LoginPage />)

    expect(screen.getByText('TOD - The Other Dude')).toBeInTheDocument()
    expect(screen.getByText('MSP Fleet Management')).toBeInTheDocument()
  })

  it('shows error message on failed login', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'))
    authState.error = null

    render(<LoginPage />)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/email/i), 'test@example.com')
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    // After the failed login, the useAuth store would set error.
    // Since we control the mock, we need to re-render with the error state.
    // Let's update authState and re-render.
    authState.error = 'Invalid credentials'

    // The component should re-render via zustand. In our mock, it won't
    // automatically. Let's re-render.
    render(<LoginPage />)

    expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
  })

  it('submits form with entered credentials', async () => {
    mockLogin.mockResolvedValueOnce(undefined)

    render(<LoginPage />)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/email/i), 'admin@example.com')
    await user.type(screen.getByLabelText(/password/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin@example.com', 'secret123')
    })
  })

  it('navigates to home on successful login', async () => {
    mockLogin.mockResolvedValueOnce(undefined)

    render(<LoginPage />)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/email/i), 'admin@example.com')
    await user.type(screen.getByLabelText(/password/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
    })
  })

  it('disables submit button when fields are empty', () => {
    render(<LoginPage />)

    const submitButton = screen.getByRole('button', { name: /sign in/i })
    expect(submitButton).toBeDisabled()
  })

  it('shows "Signing in..." text while submitting', async () => {
    // Make login hang (never resolve)
    mockLogin.mockReturnValueOnce(new Promise(() => {}))

    render(<LoginPage />)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/email/i), 'admin@example.com')
    await user.type(screen.getByLabelText(/password/i), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /signing in/i })).toBeInTheDocument()
    })
  })

  it('clears error when user starts typing', async () => {
    authState.error = 'Invalid credentials'

    render(<LoginPage />)

    expect(screen.getByText('Invalid credentials')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/email/i), 'a')

    expect(mockClearError).toHaveBeenCalled()
  })
})
