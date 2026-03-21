import { RouterProvider, createRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { routeTree } from './routeTree.gen'
import { useAuth } from './lib/auth'
import { LoadingText } from './components/ui/skeleton'

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

  // Only show loading text during initial auth check -- NOT on subsequent isLoading changes.
  // Reacting to isLoading here would unmount the entire router tree (including LoginPage)
  // every time an auth action sets isLoading, destroying all component local state.
  if (!hasChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <LoadingText />
      </div>
    )
  }

  return <RouterProvider router={router} />
}

export default AppInner
