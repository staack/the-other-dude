import { createFileRoute } from '@tanstack/react-router'
import { MapPage } from '@/components/map/MapPage'

export const Route = createFileRoute('/_authenticated/map')({
  component: MapPage,
})
