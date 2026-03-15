import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { ConnectionState } from '@/hooks/useEventStream'

interface EventStreamContextValue {
  connectionState: ConnectionState
  lastConnectedAt: Date | null
  reconnect: () => void
}

const EventStreamContext = createContext<EventStreamContextValue>({
  connectionState: 'disconnected',
  lastConnectedAt: null,
  reconnect: () => {},
})

export function EventStreamProvider({
  connectionState,
  lastConnectedAt,
  reconnect,
  children,
}: EventStreamContextValue & { children: ReactNode }) {
  return (
    <EventStreamContext.Provider value={{ connectionState, lastConnectedAt, reconnect }}>
      {children}
    </EventStreamContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEventStreamContext() {
  return useContext(EventStreamContext)
}

export { EventStreamContext }
