package ga4

import "context"

// NewTestContext creates a cancellable context for tests that construct a
// Client directly (e.g. the client lifecycle tests in client_test.go).
func NewTestContext() (context.Context, context.CancelFunc) {
	return context.WithCancel(context.Background())
}
