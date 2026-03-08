import { createFileRoute } from '@tanstack/react-router'
import { FirmwarePage } from '@/components/firmware/FirmwarePage'

export const Route = createFileRoute('/_authenticated/firmware')({
  component: FirmwarePage,
})
