import { createFileRoute } from '@tanstack/react-router'
import { CertificatesPage } from '@/components/certificates/CertificatesPage'

export const Route = createFileRoute('/_authenticated/certificates')({
  component: CertificatesPage,
})
