import { AxiosError } from 'axios'

/**
 * Extract a human-readable error message from any error type.
 * Priority: API detail > Axios status mapping > Error.message > fallback
 */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail

    switch (error.response?.status) {
      case 400: return 'Invalid request. Please check your input.'
      case 401: return 'Your session has expired. Please sign in again.'
      case 403: return 'You do not have permission for this action.'
      case 404: return 'The requested resource was not found.'
      case 409: return detail || 'This action conflicts with the current state.'
      case 422: return 'Please check your input and try again.'
      case 429: return 'Too many requests. Please wait a moment and try again.'
      case 500: return 'Something went wrong on our end. Please try again.'
      case 502:
      case 503: return 'The service is temporarily unavailable. Please try again later.'
      default: return fallback
    }
  }

  if (error instanceof Error) {
    if (error.message.startsWith('Request failed with status code')) {
      return fallback
    }
    return error.message
  }

  return fallback
}

/**
 * Extract error message specifically for auth flows.
 */
export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail

    switch (error.response?.status) {
      case 400: return 'Sign in failed. Please check your credentials.'
      case 401: return 'Invalid email or password.'
      case 500: return 'Something went wrong during sign in. Please try again.'
      default: return 'Sign in failed. Please try again.'
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Sign in failed. Please try again.'
}
