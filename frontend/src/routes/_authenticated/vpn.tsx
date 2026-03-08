import { createFileRoute } from '@tanstack/react-router'
import { VpnPage } from '@/components/vpn/VpnPage'

export const Route = createFileRoute('/_authenticated/vpn')({
  component: VpnPage,
})
