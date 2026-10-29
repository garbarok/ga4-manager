package ga4

import (
	"context"
	"os"
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/stretchr/testify/assert"
)

// TestNewClient_WithoutCredentials tests that NewClient fails without credentials
func TestNewClient_WithoutCredentials(t *testing.T) {
	// Save original env var
	originalCreds := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	defer func() {
		_ = os.Setenv("GOOGLE_APPLICATION_CREDENTIALS", originalCreds)
	}()

	// Unset the credential file
	_ = os.Unsetenv("GOOGLE_APPLICATION_CREDENTIALS")

	client, err := NewClient()

	assert.Error(t, err)
	assert.Nil(t, client)
	assert.Contains(t, err.Error(), "GOOGLE_APPLICATION_CREDENTIALS not set")
}

// TestNewClient_WithInvalidCredentials tests that NewClient fails with invalid credentials file
func TestNewClient_WithInvalidCredentials(t *testing.T) {
	// Save original env var
	originalCreds := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	defer func() {
		_ = os.Setenv("GOOGLE_APPLICATION_CREDENTIALS", originalCreds)
	}()

	// Set invalid credentials file path
	_ = os.Setenv("GOOGLE_APPLICATION_CREDENTIALS", "/nonexistent/path/to/credentials.json")

	client, err := NewClient()

	assert.Error(t, err)
	assert.Nil(t, client)
	assert.Contains(t, err.Error(), "failed to create admin service")
}

// TestClientClose tests that the client can be closed without panic
func TestClientClose(t *testing.T) {
	ctx, cancel := NewTestContext()
	defer cancel()

	client := &Client{
		ctx:    ctx,
		cancel: cancel,
		logger: createLogger(config.DefaultClientConfig().Logging),
	}

	// Should not panic
	assert.NotPanics(t, func() {
		client.Close()
	})
}

// TestClientClose_WithNilCancel tests that Close handles nil cancel gracefully
func TestClientClose_WithNilCancel(t *testing.T) {
	ctx := context.Background()

	client := &Client{
		ctx:    ctx,
		cancel: nil,
		logger: createLogger(config.DefaultClientConfig().Logging),
	}

	// Should not panic
	assert.NotPanics(t, func() {
		client.Close()
	})
}

// TestClientContextCancellation tests that context is properly cancelled
func TestClientContextCancellation(t *testing.T) {
	ctx, cancel := NewTestContext()

	client := &Client{
		ctx:    ctx,
		cancel: cancel,
		logger: createLogger(config.DefaultClientConfig().Logging),
	}

	// Context should not be cancelled initially
	select {
	case <-ctx.Done():
		t.Fatal("context should not be cancelled initially")
	default:
	}

	// Close the client
	client.Close()

	// Context should now be cancelled
	<-ctx.Done()
}

// BenchmarkNewClient benchmarks client creation (will fail without valid creds)
func BenchmarkNewClient(b *testing.B) {
	// This benchmark requires valid credentials
	credFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if credFile == "" {
		b.Skip("GOOGLE_APPLICATION_CREDENTIALS not set, skipping benchmark")
	}

	b.ReportAllocs()
	for b.Loop() {
		client, err := NewClient()
		if err != nil {
			b.Fatalf("unexpected error: %v", err)
		}
		if client != nil {
			client.Close()
		}
	}
}
