import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/login" className="text-sm text-accent hover:underline mb-8 inline-block">
          &larr; Back
        </Link>

        <h1 className="text-2xl font-bold text-text-primary mb-2">Privacy Policy</h1>
        <p className="text-sm text-text-muted mb-8">Last updated: March 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-text-secondary">
          <section>
            <h2 className="text-lg font-semibold text-text-primary">1. Overview</h2>
            <p>
              The Other Dude is self-hosted software. All data is stored on infrastructure
              you own and control. The authors do not collect, transmit, or have access to any
              of your data. This privacy policy describes what data the Software stores locally
              on your deployment.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">2. Data We Store</h2>
            <p>When deployed, The Other Dude stores the following data in your local database:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>User accounts:</strong> Email addresses, names, and authentication data.
                Passwords are never stored &mdash; The Other Dude uses SRP-6a zero-knowledge
                authentication, meaning the server only stores a cryptographic verifier derived
                from your password, never the password itself.
              </li>
              <li>
                <strong>Encryption key material:</strong> Per-user encrypted key sets for
                zero-knowledge encryption. Your Secret Key is stored only in your browser
                (IndexedDB) and is never transmitted to or stored on the server.
              </li>
              <li>
                <strong>Device credentials:</strong> RouterOS usernames and passwords for managed
                devices, encrypted at rest with AES-256-GCM via per-tenant envelope encryption.
              </li>
              <li>
                <strong>Device data:</strong> Hostnames, IP addresses, firmware versions, hardware
                models, and configuration backups retrieved from your MikroTik devices.
              </li>
              <li>
                <strong>Metrics:</strong> Time-series performance data (CPU, memory, bandwidth,
                wireless stats) collected from your devices by the polling service.
              </li>
              <li>
                <strong>Audit logs:</strong> Records of user actions within the portal (logins,
                configuration changes, device management operations). Encrypted at rest with
                zero-knowledge encryption.
              </li>
              <li>
                <strong>Certificates:</strong> TLS certificates and encrypted private keys generated
                by the internal certificate authority for device API connections.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">3. No External Transmission</h2>
            <p>
              The Other Dude does not send any data to external servers, analytics services,
              or third parties. All communication occurs between the portal and your MikroTik
              devices over your local or private network. The only outbound connections are:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Firmware checks:</strong> Queries the MikroTik download server to check
                for RouterOS updates (no device data is sent).
              </li>
              <li>
                <strong>Email notifications:</strong> If configured, alert emails are sent via
                your SMTP server. Only alert data you configure is included.
              </li>
              <li>
                <strong>Webhook notifications:</strong> If configured, alert data is sent to
                webhook URLs you specify.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">4. Multi-Tenancy</h2>
            <p>
              The Other Dude supports multiple tenants (organizations). Data isolation between
              tenants is enforced at the database level using PostgreSQL Row-Level Security (RLS).
              Each tenant can only access their own devices, users, and data. The super_admin
              role has cross-tenant visibility for platform administration.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">5. Security Measures</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>SRP-6a zero-knowledge authentication (server never sees your password)</li>
              <li>Zero-knowledge encryption for config backups and audit logs</li>
              <li>Per-tenant envelope encryption via KMS</li>
              <li>Device credentials encrypted with AES-256-GCM</li>
              <li>JWT tokens with short expiry (15 minutes) in httpOnly cookies</li>
              <li>Rate limiting on authentication endpoints</li>
              <li>RBAC with four permission levels</li>
              <li>Security headers (CSP, X-Frame-Options, HSTS)</li>
              <li>Subresource Integrity (SRI) hashes on JavaScript bundles</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">6. Your Rights</h2>
            <p>
              As a user of this deployment, you have the following rights regarding your personal data:
            </p>
            <ul className="list-disc pl-6 space-y-3">
              <li>
                <strong>Right of Access (Art. 15):</strong> You can view your account information
                on the Settings page at any time.
              </li>
              <li>
                <strong>Right to Data Portability (Art. 20):</strong> You can export all your
                personal data in JSON format from Settings &gt; Export My Data.
              </li>
              <li>
                <strong>Right to Erasure (Art. 17):</strong> You can permanently delete your
                account and all associated personal data from Settings &gt; Delete Account.
                This action:
                <ul className="list-disc pl-6 mt-1 space-y-1">
                  <li>Hard-deletes your user account, encrypted key sets, and API keys</li>
                  <li>Anonymizes your entries in the audit log (removes email/name, retains action records)</li>
                  <li>Creates a deletion receipt for compliance verification</li>
                  <li>Is irreversible &mdash; there is no recovery after deletion</li>
                </ul>
              </li>
              <li>
                <strong>Right to Rectification (Art. 16):</strong> Contact your administrator
                to update your account information.
              </li>
            </ul>
            <p className="mt-3">
              These rights can be exercised through the Settings page when logged in, or by
              contacting your deployment administrator.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">7. Data Retention</h2>
            <p className="mb-4">
              The Other Dude applies the following data retention periods:
            </p>
            <div className="not-prose">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-medium text-text-primary">Data Type</th>
                    <th className="text-left py-2 pr-4 font-medium text-text-primary">Retention Period</th>
                    <th className="text-left py-2 font-medium text-text-primary">Notes</th>
                  </tr>
                </thead>
                <tbody className="text-text-secondary">
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">User accounts</td>
                    <td className="py-2 pr-4">Until deleted</td>
                    <td className="py-2">Users can self-delete from Settings</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Device metrics</td>
                    <td className="py-2 pr-4">90 days</td>
                    <td className="py-2">Automatically purged by TimescaleDB retention policy</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Configuration backups</td>
                    <td className="py-2 pr-4">Indefinite</td>
                    <td className="py-2">Stored in git repositories on your server</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Audit logs</td>
                    <td className="py-2 pr-4">Indefinite</td>
                    <td className="py-2">Anonymized on account deletion; action records retained</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">API keys</td>
                    <td className="py-2 pr-4">Until revoked or user deleted</td>
                    <td className="py-2">Cascade-deleted with user account</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Encrypted key material</td>
                    <td className="py-2 pr-4">Until user deleted</td>
                    <td className="py-2">Cascade-deleted with user account</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Session data (Redis)</td>
                    <td className="py-2 pr-4">15 min (access) / 7 days (refresh)</td>
                    <td className="py-2">Auto-expiring tokens</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">Password reset tokens</td>
                    <td className="py-2 pr-4">Until used or 30 minutes</td>
                    <td className="py-2">Auto-expire, cascade-deleted with user</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4">
              After account deletion, all personally identifiable information is permanently
              erased. Anonymized audit log entries (with no PII) are retained for security compliance.
            </p>
            <p>
              After tenant deactivation, all tenant data (devices, metrics, configurations, user
              accounts) is retained until the super admin explicitly deletes the tenant, at which
              point all data is cascade-deleted.
            </p>
            <p>
              You control all retention through your database and can adjust these periods in
              your deployment configuration.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">8. Cookies</h2>
            <p>
              The Other Dude uses a single httpOnly session cookie for authentication. No
              tracking cookies, analytics cookies, or third-party cookies are used. The
              application also uses localStorage for user preferences (theme, sidebar state,
              configuration mode).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">9. Your Responsibilities</h2>
            <p>
              As the operator of a self-hosted deployment, you are the data controller. You are
              responsible for compliance with applicable data protection laws (GDPR, CCPA, etc.)
              in your jurisdiction, including data subject access requests and breach notification.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">10. Contact</h2>
            <p>
              For questions about this privacy policy or the data practices of The Other Dude,
              please open an issue in the project repository.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
