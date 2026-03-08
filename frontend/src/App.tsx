import { RouterProvider, createRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { routeTree } from './routeTree.gen'
import { useAuth } from './lib/auth'
import { Skeleton } from './components/ui/skeleton'

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function AppInner() {
  const { checkAuth } = useAuth()
  const [hasChecked, setHasChecked] = useState(false)

  useEffect(() => {
    checkAuth().finally(() => setHasChecked(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only show skeleton during initial auth check -- NOT on subsequent isLoading changes.
  // Reacting to isLoading here would unmount the entire router tree (including LoginPage)
  // every time an auth action sets isLoading, destroying all component local state.
  if (!hasChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    )
  }

  return <RouterProvider router={router} />
}

export default AppInner
