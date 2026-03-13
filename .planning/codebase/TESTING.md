# Testing Patterns

**Analysis Date:** 2026-03-12

## Test Framework

**Frontend:**

Runner:
- Vitest 4.0.18
- Config: `frontend/vitest.config.ts`
- Environment: jsdom (browser simulation)
- Globals enabled: true

Assertion Library:
- Testing Library (React) - `@testing-library/react`
- Testing Library User Events - `@testing-library/user-event`
- Testing Library Jest DOM matchers - `@testing-library/jest-dom`
- Vitest's built-in expect (compatible with Jest)

Run Commands:
```bash
npm run test              # Run all tests once
npm run test:watch       # Watch mode (re-runs on file change)
npm run test:coverage    # Generate coverage report
npm run test:e2e         # E2E tests with Playwright
npm run test:e2e:headed  # E2E tests with visible browser
```

**Backend:**

Runner:
- pytest 8.0.0
- Config: `pyproject.toml` with `asyncio_mode = "auto"`
- Plugins: pytest-asyncio, pytest-mock, pytest-cov
- Markers: `integration` (marked tests requiring PostgreSQL)

Run Commands:
```bash
pytest                        # Run all tests
pytest -m "not integration"   # Run unit tests only
pytest -m integration         # Run integration tests only
pytest --cov=app              # Generate coverage report
pytest -v                     # Verbose output
```

**Go (Poller):**

Runner:
- Go's built-in testing package
- Config: implicit (no config file)
- Assertions: testify/assert, testify/require
- Test containers for integration tests (PostgreSQL, Redis, NATS)

Run Commands:
```bash
go test ./...              # Run all tests
go test -v ./...           # Verbose output
go test -run TestName ...  # Run specific test
go test -race ./...        # Race condition detection
```

## Test File Organization

**Frontend:**

Location:
- Co-located with components in `__tests__` subdirectory
- Pattern: `src/components/__tests__/{component}.test.tsx`
- Shared test utilities in `src/test/test-utils.tsx`
- Test setup in `src/test/setup.ts`

Examples:
- `frontend/src/components/__tests__/LoginPage.test.tsx`
- `frontend/src/components/__tests__/DeviceList.test.tsx`
- `frontend/src/components/__tests__/TemplatePushWizard.test.tsx`

Naming:
- Test files: `{Component}.test.tsx` (matches component name)
- Vitest config includes: `'src/**/*.test.{ts,tsx}'`

**Backend:**

Location:
- Separate `tests/` directory at project root
- Organization: `tests/unit/` and `tests/integration/`
- Pattern: `tests/unit/test_{module}.py`

Examples:
- `backend/tests/unit/test_auth.py`
- `backend/tests/unit/test_security.py`
- `backend/tests/unit/test_crypto.py`
- `backend/tests/unit/test_audit_service.py`
- `backend/tests/conftest.py` (shared fixtures)
- `backend/tests/integration/conftest.py` (database fixtures)

**Go:**

Location:
- Co-located with implementation: `{file}.go` and `{file}_test.go`
- Pattern: `internal/poller/scheduler_test.go` alongside `scheduler.go`

Examples:
- `poller/internal/poller/scheduler_test.go`
- `poller/internal/sshrelay/server_test.go`
- `poller/internal/poller/integration_test.go`

## Test Structure

**Frontend (Vitest + React Testing Library):**

Suite Organization:
```typescript
/**
 * Component tests -- description of what is tested
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  // mock implementation
}))

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders login form with email and password fields', () => {
    render(<LoginPage />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  })

  it('submits form with entered credentials', async () => {
    render(<LoginPage />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/email/i), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', expect.any(String))
    })
  })
})
```

Patterns:
- Mocks defined before imports, then imported components
- Section comments: `// ---------- Mocks ----------`, `// ---------- Tests ----------`
- `describe()` blocks for test suites
- `beforeEach()` for test isolation and cleanup
- `userEvent.setup()` for simulating user interactions
- `waitFor()` for async assertions
- Accessibility-first selectors: `getByLabelText`, `getByRole` over `getByTestId`

**Backend (pytest):**

Suite Organization:
```python
"""Unit tests for the JWT authentication service.

Tests cover:
- Password hashing and verification (bcrypt)
- JWT access token creation and validation
"""

import pytest
from unittest.mock import patch

class TestPasswordHashing:
    """Tests for bcrypt password hashing."""

    def test_hash_returns_different_string(self):
        password = "test-password-123!"
        hashed = hash_password(password)
        assert hashed != password

    def test_hash_verify_roundtrip(self):
        password = "test-password-123!"
        hashed = hash_password(password)
        assert verify_password(password, hashed) is True
```

Patterns:
- Module docstring describing test scope
- Test classes for grouping related tests: `class TestPasswordHashing:`
- Test methods: `def test_{behavior}(self):`
- Assertions: `assert condition` (pytest style)
- Fixtures defined in conftest.py for async/db setup

**Go:**

Suite Organization:
```go
package poller

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockDeviceFetcher implements DeviceFetcher for testing.
type mockDeviceFetcher struct {
	devices []store.Device
	err     error
}

func (m *mockDeviceFetcher) FetchDevices(ctx context.Context) ([]store.Device, error) {
	return m.devices, m.err
}

func newTestScheduler(fetcher DeviceFetcher) *Scheduler {
	// Create test instance with mocked dependencies
	return &Scheduler{...}
}

func TestReconcileDevices_StartsNewDevices(t *testing.T) {
	devices := []store.Device{...}
	fetcher := &mockDeviceFetcher{devices: devices}
	sched := newTestScheduler(fetcher)

	var wg sync.WaitGroup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := sched.reconcileDevices(ctx, &wg)
	require.NoError(t, err)

	sched.mu.Lock()
	assert.Len(t, sched.activeDevices, 2)
	sched.mu.Unlock()
}
```

Patterns:
- Mock types defined at package level (not inside test functions)
- Constructor helper: `newTest{Subject}(...)` for creating test instances
- Test function signature: `func Test{Subject}_{Scenario}(t *testing.T)`
- testify assertions: `assert.Len()`, `require.NoError()`
- Context management with defer for cleanup
- Concurrent access protected by locks (shown in assertions)

## Mocking

**Frontend:**

Framework: vitest `vi` object

Patterns:
```typescript
// Mock module imports
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, ...props }) => <a href={props.to}>{children}</a>,
}))

// Mock with partial real imports
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    devicesApi: {
      ...actual.devicesApi,
      list: (...args: unknown[]) => mockDevicesList(...args),
    },
  }
})

// Create spy/mock functions
const mockLogin = vi.fn()
const mockNavigate = vi.fn()

// Configure mock behavior
mockLogin.mockResolvedValueOnce(undefined)        // Resolve once
mockLogin.mockRejectedValueOnce(new Error('...')) // Reject once
mockLogin.mockReturnValueOnce(new Promise(...))   // Return pending promise

// Clear mocks between tests
beforeEach(() => {
  vi.clearAllMocks()
})

// Assert mock was called
expect(mockLogin).toHaveBeenCalledWith('email', 'password')
expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
```

What to Mock:
- External API calls (via axios/fetch)
- Router navigation (TanStack Router)
- Zustand store state (create mock `authState`)
- External libraries with complex behavior

What NOT to Mock:
- DOM elements (use Testing Library queries instead)
- React hooks from react-testing-library
- Component rendering (test actual render unless circular dependency)

**Backend (Python):**

Framework: pytest-mock (monkeypatch) and unittest.mock

Patterns:
```python
# Fixture-based mocking
@pytest.fixture
def mock_db(monkeypatch):
    # monkeypatch.setattr(module, 'function', mock_fn)
    pass

# Patch in test
def test_something(monkeypatch):
    mock_fn = monkeypatch.setattr('app.services.auth.hash_password', mock_hash)

# Mock with context manager
from unittest.mock import patch

def test_redis():
    with patch('app.routers.auth.get_redis') as mock_redis:
        mock_redis.return_value = MagicMock()
        # test code
```

What to Mock:
- Database queries (return test data)
- External HTTP calls
- Redis operations
- Email sending
- File I/O

What NOT to Mock:
- Core business logic (hash_password, verify_token)
- Pydantic model validation
- SQLAlchemy relationship traversal (in integration tests)

**Go:**

Framework: testify/mock or simple interfaces

Patterns:
```go
// Interface-based mocking
type mockDeviceFetcher struct {
	devices []store.Device
	err     error
}

func (m *mockDeviceFetcher) FetchDevices(ctx context.Context) ([]store.Device, error) {
	return m.devices, m.err
}

// Use interface, not concrete type
func newTestScheduler(fetcher DeviceFetcher) *Scheduler {
	return &Scheduler{store: fetcher, ...}
}

// Configure in test
sched := newTestScheduler(&mockDeviceFetcher{
	devices: []store.Device{...},
	err:     nil,
})
```

What to Mock:
- Database/store interfaces
- External service calls (HTTP, SSH)
- Redis operations

What NOT to Mock:
- Standard library functions
- Core business logic

## Fixtures and Factories

**Frontend Test Data:**

Approach: Inline test data in test file

Example from `DeviceList.test.tsx`:
```typescript
const testDevices: DeviceListResponse = {
  items: [
    {
      id: 'dev-1',
      hostname: 'router-office-1',
      ip_address: '192.168.1.1',
      api_port: 8728,
      api_ssl_port: 8729,
      model: 'RB4011',
      serial_number: 'ABC123',
      firmware_version: '7.12',
      routeros_version: '7.12.1',
      uptime_seconds: 86400,
      last_seen: '2026-03-01T12:00:00Z',
      latitude: null,
      longitude: null,
      status: 'online',
    },
  ],
  total: 1,
}
```

**Test Utilities:**

Location: `frontend/src/test/test-utils.tsx`

Wrapper with providers:
```typescript
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const queryClient = createTestQueryClient()

  function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    queryClient,
  }
}

export { renderWithProviders as render }
```

Usage: Import `render` from test-utils, which automatically provides React Query

**Backend Fixtures:**

Location: `backend/tests/conftest.py` (unit), `backend/tests/integration/conftest.py` (integration)

Base conftest:
```python
def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests requiring PostgreSQL"
    )
```

Integration fixtures (in `tests/integration/conftest.py`):
- Database fixtures (SQLAlchemy AsyncSession)
- Redis test instance (testcontainers)
- NATS JetStream test server

**Go Test Helpers:**

Location: Helper functions defined in `_test.go` files

Example from `scheduler_test.go`:
```go
// mockDeviceFetcher implements DeviceFetcher for testing.
type mockDeviceFetcher struct {
	devices []store.Device
	err     error
}

func (m *mockDeviceFetcher) FetchDevices(ctx context.Context) ([]store.Device, error) {
	return m.devices, m.err
}

// newTestScheduler creates a Scheduler with a mock DeviceFetcher for testing.
func newTestScheduler(fetcher DeviceFetcher) *Scheduler {
	testCache := vault.NewCredentialCache(64, 5*time.Minute, nil, make([]byte, 32), nil)
	return &Scheduler{
		store:           fetcher,
		locker:          nil,
		publisher:       nil,
		credentialCache: testCache,
		pollInterval:    24 * time.Hour,
		connTimeout:     time.Second,
		cmdTimeout:      time.Second,
		refreshPeriod:   time.Second,
		maxFailures:     5,
		baseBackoff:     30 * time.Second,
		maxBackoff:      15 * time.Minute,
		activeDevices:   make(map[string]*deviceState),
	}
}
```

## Coverage

**Frontend:**

Requirements: Not enforced (no threshold in vitest config)

View Coverage:
```bash
npm run test:coverage
# Generates coverage in frontend/coverage/ directory
```

**Backend:**

Requirements: Not enforced in config (but tracked)

View Coverage:
```bash
pytest --cov=app --cov-report=term-missing
pytest --cov=app --cov-report=html  # Generates htmlcov/index.html
```

**Go:**

Requirements: Not enforced

View Coverage:
```bash
go test -cover ./...
go tool cover -html=coverage.out  # Visual report
```

## Test Types

**Frontend Unit Tests:**

Scope:
- Individual component rendering
- User interactions (click, type)
- Component state changes
- Props and variant rendering

Approach:
- Render component with test-utils
- Simulate user events with userEvent
- Assert on rendered DOM

Example from `LoginPage.test.tsx`:
```typescript
it('renders login form with email and password fields', () => {
  render(<LoginPage />)
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
})

it('submits form with entered credentials', async () => {
  mockLogin.mockResolvedValueOnce(undefined)
  render(<LoginPage />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email/i), 'admin@example.com')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  await waitFor(() => {
    expect(mockLogin).toHaveBeenCalledWith('admin@example.com', 'secret123')
  })
})
```

**Frontend E2E Tests:**

Framework: Playwright
Config: `frontend/playwright.config.ts`

Approach:
- Launch real browser
- Navigate through app
- Test full user journeys
- Sequential execution (no parallelization) for stability

Config highlights:
```typescript
fullyParallel: false,    // Run sequentially for stability
workers: 1,              // Single worker
timeout: 30000,          // 30 second timeout per test
retries: process.env.CI ? 2 : 0,  // Retry in CI
```

Location: `frontend/tests/e2e/` (referenced in playwright config)

**Backend Unit Tests:**

Scope:
- Pure function behavior (hash_password, verify_token)
- Service methods without database
- Validation logic

Approach:
- No async/await needed unless using mocking
- Direct function calls
- Assert on return values

Example from `test_auth.py`:
```python
class TestPasswordHashing:
    def test_hash_returns_different_string(self):
        password = "test-password-123!"
        hashed = hash_password(password)
        assert hashed != password

    def test_hash_verify_roundtrip(self):
        password = "test-password-123!"
        hashed = hash_password(password)
        assert verify_password(password, hashed) is True
```

**Backend Integration Tests:**

Scope:
- Full request/response cycle
- Database operations with fixtures
- External service interactions (Redis, NATS)

Approach:
- Marked with `@pytest.mark.integration`
- Use async fixtures for database
- Skip with `-m "not integration"` in CI (slow)

Location: `backend/tests/integration/`

Example:
```python
@pytest.mark.integration
async def test_login_creates_session(async_db, client):
    # Creates user in test database
    # Posts to /api/auth/login
    # Asserts JWT tokens in response
    pass
```

**Go Tests:**

Scope: Unit tests for individual functions, integration tests for subsystems

Unit test example:
```go
func TestReconcileDevices_StartsNewDevices(t *testing.T) {
	devices := []store.Device{...}
	fetcher := &mockDeviceFetcher{devices: devices}
	sched := newTestScheduler(fetcher)

	var wg sync.WaitGroup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := sched.reconcileDevices(ctx, &wg)
	require.NoError(t, err)

	sched.mu.Lock()
	assert.Len(t, sched.activeDevices, 2)
	sched.mu.Unlock()

	cancel()
	wg.Wait()
}
```

Integration test: Uses testcontainers for PostgreSQL, Redis, NATS (e.g., `integration_test.go`)

## Common Patterns

**Async Testing (Frontend):**

Pattern for testing async operations:
```typescript
it('navigates to home on successful login', async () => {
  mockLogin.mockResolvedValueOnce(undefined)

  render(<LoginPage />)

  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email/i), 'admin@example.com')
  await user.type(screen.getByLabelText(/password/i), 'secret123')
  await user.click(screen.getByRole('button', { name: /sign in/i }))

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })
})
```

- Use `userEvent.setup()` for user interactions
- Use `await waitFor()` for assertions on async results
- Mock promises with `mockFn.mockResolvedValueOnce()` or `mockRejectedValueOnce()`

**Error Testing (Frontend):**

Pattern for testing error states:
```typescript
it('shows error message on failed login', async () => {
  mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'))
  authState.error = null

  render(<LoginPage />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email/i), 'test@example.com')
  await user.type(screen.getByLabelText(/password/i), 'wrongpassword')
  await user.click(screen.getByRole('button', { name: /sign in/i }))

  authState.error = 'Invalid credentials'
  render(<LoginPage />)

  expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
})
```

**Async Testing (Backend):**

Pattern for async pytest:
```python
@pytest.mark.asyncio
async def test_get_redis():
    redis = await get_redis()
    assert redis is not None
```

Configure in `pyproject.toml`: `asyncio_mode = "auto"` (enabled globally)

**Error Testing (Backend):**

Pattern for testing exceptions:
```python
def test_verify_token_rejects_expired():
    token = create_access_token(user_id=uuid4(), expires_delta=timedelta(seconds=-1))
    with pytest.raises(HTTPException) as exc_info:
        verify_token(token, expected_type="access")
    assert exc_info.value.status_code == 401
```

---

*Testing analysis: 2026-03-12*
