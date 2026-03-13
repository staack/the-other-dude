# Coding Conventions

**Analysis Date:** 2026-03-12

## Naming Patterns

**Files:**
- TypeScript/React: `kebab-case.ts`, `kebab-case.tsx` (e.g., `useShortcut.ts`, `error-boundary.tsx`)
- Python: `snake_case.py` (e.g., `test_auth.py`, `auth_service.py`)
- Go: `snake_case.go` (e.g., `scheduler_test.go`, `main.go`)
- Component files: PascalCase for exported components in UI libraries (e.g., `Button` from `button.tsx`)
- Test files: `{module}.test.tsx`, `{module}.spec.tsx` (frontend), `test_{module}.py` (backend)

**Functions:**
- TypeScript/JavaScript: `camelCase` (e.g., `useShortcut`, `createApiClient`, `renderWithProviders`)
- Python: `snake_case` (e.g., `hash_password`, `verify_token`, `get_redis`)
- Go: `PascalCase` for exported, `camelCase` for private (e.g., `FetchDevices`, `mockDeviceFetcher`)
- React hooks: Prefix with `use` (e.g., `useAuth`, `useShortcut`, `useSequenceShortcut`)

**Variables:**
- TypeScript: `camelCase` (e.g., `mockLogin`, `authState`, `refreshPromise`)
- Python: `snake_case` (e.g., `user_id`, `tenant_id`, `credentials`)
- Constants: `UPPER_SNAKE_CASE` for module-level constants (e.g., `ACCESS_TOKEN_COOKIE`, `REFRESH_TOKEN_MAX_AGE`)

**Types:**
- TypeScript interfaces: `PascalCase` with `I` prefix optional (e.g., `ButtonProps`, `AuthState`, `WrapperProps`)
- Python: `PascalCase` for classes (e.g., `User`, `UserRole`, `HTTPException`)
- Go: `PascalCase` for exported (e.g., `Scheduler`, `Device`), `camelCase` for private (e.g., `mockDeviceFetcher`)

**Directories:**
- Feature/module directories: `kebab-case` (e.g., `remote-access`, `device-groups`)
- Functional directories: `kebab-case` (e.g., `__tests__`, `components`, `routers`)
- Python packages: `snake_case` (e.g., `app/models`, `app/services`)

## Code Style

**Formatting:**

Frontend:
- Tool: ESLint + TypeScript ESLint (flat config at `frontend/eslint.config.js`)
- Indentation: 2 spaces
- Line length: No explicit limit in config, but code stays under 120 chars
- Quotes: Single quotes in JS/TS (ESLint recommended)
- Semicolons: Required
- Trailing commas: Yes (ES2020+)

Backend (Python):
- Tool: Ruff for linting
- Line length: 100 characters (`ruff` configured in `pyproject.toml`)
- Indentation: 4 spaces (PEP 8)
- Type hints: Required on function signatures (Pydantic models and FastAPI handlers)

Poller (Go):
- Gofmt standard (implicit)
- Line length: conventional Go style
- Error handling: `if err != nil` pattern

**Linting:**

Frontend:
- ESLint config: `@eslint/js`, `typescript-eslint`, `react-hooks`, `react-refresh`
- Run: `npm run lint`
- Rules: Recommended + React hooks rules
- No unused locals/parameters enforced via TypeScript `noUnusedLocals` and `noUnusedParameters`

Backend (Python):
- Ruff enabled for style and lint
- Target version: Python 3.12
- Line length: 100

## Import Organization

**Frontend (TypeScript/React):**

Order:
1. React and React-adjacent imports (`import { ... } from 'react'`)
2. Third-party libraries (`import { ... } from '@tanstack/react-query'`)
3. Local absolute imports using `@` alias (`import { ... } from '@/lib/api'`)
4. Local relative imports (`import { ... } from '../utils'`)

Path Aliases:
- `@/*` maps to `src/*` (configured in `tsconfig.app.json`)

Example from `useShortcut.ts`:
```typescript
import { useEffect, useRef } from 'react'
// (no third-party imports in this file)
// (no local imports needed)
```

Example from `auth.ts`:
```typescript
import { create } from 'zustand'
import { authApi, type UserMe } from './api'
import { keyStore } from './crypto/keyStore'
import { deriveKeysInWorker } from './crypto/keys'
```

**Backend (Python):**

Order:
1. Standard library (`import uuid`, `from typing import ...`)
2. Third-party (`from fastapi import ...`, `from sqlalchemy import ...`)
3. Local imports (`from app.services.auth import ...`, `from app.models.user import ...`)

Standard pattern in routers (e.g., `auth.py`):
```python
import logging
from datetime import UTC, datetime, timedelta
from typing import Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.config import settings
from app.database import get_admin_db
from app.services.auth import verify_password
```

**Go:**

Order:
1. Standard library (`"context"`, `"log/slog"`)
2. Third-party (`github.com/...`)
3. Local module imports (`github.com/mikrotik-portal/poller/...`)

Example from `main.go`:
```go
import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/bsm/redislock"
	"github.com/redis/go-redis/v9"

	"github.com/mikrotik-portal/poller/internal/bus"
	"github.com/mikrotik-portal/poller/internal/config"
)
```

## Error Handling

**Frontend (TypeScript):**

- Try/catch for async operations with type guards: `const axiosErr = err as { response?: ... }`
- Error messages extracted to helpers: `getAuthErrorMessage(err)` in `lib/auth.ts`
- State-driven error UI: Store errors in Zustand (`error: string | null`), display conditionally
- Pattern: Set error, then throw to allow calling code to handle:
  ```typescript
  try {
    // operation
  } catch (err) {
    const message = getAuthErrorMessage(err)
    set({ error: message })
    throw new Error(message)
  }
  ```

**Backend (Python):**

- HTTPException from FastAPI for API errors (with status codes)
- Structured logging with structlog for all operations
- Pattern in services: raise exceptions, let routers catch and convert to HTTP responses
- Example from `auth.py` (lines 95-100):
  ```python
  async def get_redis() -> aioredis.Redis:
      global _redis
      if _redis is None:
          _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
      return _redis
  ```
- Database operations wrapped in try/finally blocks for cleanup

**Go:**

- Explicit error returns: `(result, error)` pattern
- Check and return: `if err != nil { return nil, err }`
- Structured logging with `log/slog` including error context
- Example from `scheduler_test.go`:
  ```go
  err := sched.reconcileDevices(ctx, &wg)
  require.NoError(t, err)
  ```

## Logging

**Frontend:**

- Framework: `console` (no structured logging library)
- Pattern: Inline console.log/warn/error during development
- Production: Minimal logging, errors captured in state (`auth.error`)
- Example from `auth.ts` (line 182):
  ```typescript
  console.warn('[auth] key set decryption failed (Tier 1 data will be inaccessible):', e)
  ```

**Backend (Python):**

- Framework: `structlog` for structured, JSON logging
- Logger acquisition: `logger = structlog.get_logger(__name__)` or `logging.getLogger(__name__)`
- Logging at startup/shutdown and error conditions
- Example from `main.py`:
  ```python
  logger = structlog.get_logger(__name__)
  logger.info("migrations applied successfully")
  logger.error("migration failed", stderr=result.stderr)
  ```

**Go (Poller):**

- Framework: `log/slog` (standard library)
- JSON output to stdout with service name in attributes
- Levels: Debug, Info, Warn, Error
- Example from `main.go`:
  ```go
  slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
      Level: slog.LevelInfo,
  }).WithAttrs([]slog.Attr{
      slog.String("service", "poller"),
  })))
  ```

## Comments

**When to Comment:**

- Complex logic that isn't self-documenting
- Important caveats or gotchas
- References to related issues or specs
- Example from `auth.ts` (lines 26-29):
  ```typescript
  // Response interceptor: handle 401 by attempting token refresh
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
  ```

**JSDoc/TSDoc:**

- Used for exported functions and hooks
- Example from `useShortcut.ts`:
  ```typescript
  /**
   * Hook to register a single-key keyboard shortcut.
   * Skips when focus is in INPUT, TEXTAREA, or contentEditable elements.
   */
  export function useShortcut(key: string, callback: () => void, enabled = true)
  ```

**Python Docstrings:**

- Module-level docstring at top of file describing purpose
- Function docstrings for public functions
- Example from `test_auth.py`:
  ```python
  """Unit tests for the JWT authentication service.

  Tests cover:
  - Password hashing and verification (bcrypt)
  - JWT access token creation and validation
  """
  ```

**Go Comments:**

- Package-level comment above package declaration
- Exported function/type comments above declaration
- Example from `main.go`:
  ```go
  // Command poller is the MikroTik device polling microservice.
  // It connects to RouterOS devices via the binary API...
  package main
  ```

## Function Design

**Size:**

- Frontend: Prefer hooks/components under 100 lines; break larger logic into smaller hooks
- Backend: Services typically 100-200 lines per function; larger operations split across multiple methods
- Example: `auth.ts` `srpLogin` is 130 lines but handles distinct steps (1-10 commented)

**Parameters:**

- Frontend: Functions take specific parameters, avoid large option objects except for component props
- Backend (Python): Use Pydantic schemas for request bodies, dependency injection for services
- Go: Interfaces preferred for mocking/testing (e.g., `DeviceFetcher` in `scheduler_test.go`)

**Return Values:**

- Frontend: Single return or destructured object: `return { ...render(...), queryClient }`
- Backend (Python): Single value or tuple for multiple returns (not common)
- Go: Always return `(result, error)` pair

## Module Design

**Exports:**

- TypeScript: Named exports preferred for functions/types, default export only for React components
  - Example: `export function useShortcut(...)` instead of `export default useShortcut`
  - React components: `export default AppInner` (in `App.tsx`)
- Python: All public functions/classes at module level; use `__all__` for large modules
- Go: Exported functions capitalized: `func NewScheduler(...) *Scheduler`

**Barrel Files:**

- Frontend: `test-utils.tsx` re-exports Testing Library: `export * from '@testing-library/react'`
- Backend: Not used (explicit imports preferred)
- Go: Not applicable (no barrel pattern)

## Specific Patterns Observed

**Zustand Stores (Frontend):**
- Created with `create<StateType>((set, get) => ({ ... }))`
- State shape includes loading, error, and data fields
- Actions call `set(newState)` or `get()` to access state
- Example: `useAuth` store in `lib/auth.ts` (lines 31-276)

**Zustand selectors:**
- Use selector functions for role checks: `isSuperAdmin(user)`, `isTenantAdmin(user)`, etc.
- Pattern: Pure functions that check user role

**Class Variance Authority (Frontend):**
- Used for component variants in UI library (e.g., `button.tsx`)
- Variants defined with `cva()` function with variant/size/etc. options
- Applied via `className={cn(buttonVariants({ variant, size }), className)}`

**FastAPI Routers (Backend):**
- Each feature area gets its own router file: `routers/auth.py`, `routers/devices.py`
- Routers mounted at `app.include_router(router)` in `main.py`
- Endpoints use dependency injection for auth, db, etc.

**pytest Fixtures (Backend):**
- Conftest.py at test root defines markers and shared fixtures
- Integration tests in `tests/integration/conftest.py`
- Unit tests use mocks, no database access

**Go Testing:**
- Table-driven tests not explicitly shown, but mock interfaces are (e.g., `mockDeviceFetcher`)
- Testify assertions: `assert.Len`, `require.NoError`
- Helper functions to create test data: `newTestScheduler`

---

*Convention analysis: 2026-03-12*
