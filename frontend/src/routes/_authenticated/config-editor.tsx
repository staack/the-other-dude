import { createFileRoute } from '@tanstack/react-router'
import { ConfigEditorPage } from '@/components/config-editor/ConfigEditorPage'

export const Route = createFileRoute('/_authenticated/config-editor')({
  component: ConfigEditorPage,
})
