import { createFileRoute } from '@tanstack/react-router'
import { AlertsPage } from '@/components/alerts/AlertsPage'

export const Route = createFileRoute('/_authenticated/alerts')({
  component: AlertsPage,
})
