import { createRootRoute, Outlet } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NotFoundPage } from '@/components/ui/error-boundary'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundPage,
})
