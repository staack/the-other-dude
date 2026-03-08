import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/terms')({
  component: TermsPage,
})

function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/login" className="text-sm text-accent hover:underline mb-8 inline-block">
          &larr; Back
        </Link>

        <h1 className="text-2xl font-bold text-text-primary mb-2">Terms of Service</h1>
        <p className="text-sm text-text-muted mb-8">Last updated: March 2026</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-text-secondary">
          <section>
            <h2 className="text-lg font-semibold text-text-primary">1. Acceptance of Terms</h2>
            <p>
              By accessing or using The Other Dude ("the Software"), you agree to be bound by
              these Terms of Service. The Other Dude is open-source, self-hosted software
              provided as-is for managing MikroTik RouterOS devices. If you do not agree to
              these terms, do not use the Software.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">2. License</h2>
            <p>
              The Other Dude is provided under an open-source license. You are free to use,
              modify, and distribute the Software in accordance with the license terms included
              in the source repository. The Software is not affiliated with or endorsed by
              MikroTik (SIA Mikrot&#299;kls).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">3. Self-Hosted Deployment</h2>
            <p>
              The Other Dude is designed to be self-hosted. You are responsible for your own
              deployment, including server security, database backups, network configuration,
              and access control. The authors are not responsible for any data loss, security
              breaches, or service interruptions that occur on your infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">4. Device Management</h2>
            <p>
              The Software connects to MikroTik devices using the RouterOS API. Configuration
              changes pushed through the portal use a two-phase commit with automatic rollback.
              However, you acknowledge that managing network devices carries inherent risk, and
              you are responsible for testing changes in a controlled environment before applying
              them to production networks.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">5. Credentials and Security</h2>
            <p>
              Device credentials are encrypted at rest using AES-256-GCM. You are responsible
              for securing your encryption keys, database access, and ensuring that only
              authorized users have access to the portal. Never expose the portal to the public
              internet without proper authentication and TLS.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">6. Disclaimer of Warranties</h2>
            <p>
              THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
              INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
              PARTICULAR PURPOSE, AND NONINFRINGEMENT. THE AUTHORS SHALL NOT BE LIABLE FOR ANY
              CLAIM, DAMAGES, OR OTHER LIABILITY ARISING FROM THE USE OF THE SOFTWARE.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">7. Limitation of Liability</h2>
            <p>
              In no event shall the authors be liable for any direct, indirect, incidental,
              special, or consequential damages (including loss of data, revenue, or profit)
              arising out of or in connection with the use of the Software, even if advised of
              the possibility of such damages.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-text-primary">8. Changes to Terms</h2>
            <p>
              These terms may be updated from time to time. Continued use of the Software after
              changes constitutes acceptance of the revised terms. Material changes will be
              communicated through the project repository.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
