import { createFileRoute } from '@tanstack/react-router'
import { AlertRulesPage } from '@/components/alerts/AlertRulesPage'

export const Route = createFileRoute('/_authenticated/alert-rules')({
  component: AlertRulesPage,
})
