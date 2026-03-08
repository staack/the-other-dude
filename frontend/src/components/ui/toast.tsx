import { toast as sonnerToast, Toaster as SonnerToaster } from 'sonner'
import { useUIStore } from '@/lib/store'

// Re-export Sonner's Toaster with theme-aware styling
export function Toaster() {
  const theme = useUIStore((s) => s.theme)
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        className: 'bg-surface border-border text-text-primary',
        descriptionClassName: 'text-text-secondary',
      }}
      theme={theme}
      richColors
    />
  )
}

// Preserve existing toast() API for backward compatibility
// The app calls: toast({ title: '...', description: '...', variant: 'destructive' })
interface ToastOptions {
  title: string
  description?: string
  variant?: 'default' | 'destructive'
}

export function toast(options: ToastOptions) {
  if (options.variant === 'destructive') {
    sonnerToast.error(options.title, {
      description: options.description,
    })
  } else {
    sonnerToast.success(options.title, {
      description: options.description,
    })
  }
}

// Backward-compatible no-op exports for AppLayout migration
// These were used by the old Radix Toast implementation
export const ToastProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>
export const ToastViewport = () => null
export const Toast = () => null
export const ToastTitle = () => null
export const ToastDescription = () => null
export const ToastClose = () => null
export const useToasts = () => ({ toasts: [] as never[], dismiss: () => {} })
