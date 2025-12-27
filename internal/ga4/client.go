package ga4

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"golang.org/x/time/rate"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
	"google.golang.org/api/option"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/validation"
)

type Client struct {
	admin       *admin.Service
	ctx         context.Context
	cancel      context.CancelFunc
	rateLimiter *rate.Limiter
	logger      *slog.Logger
	config      *config.ClientConfig
}

// ClientOption is a functional option for configuring the Client
type ClientOption func(*Client)

// WithConfig sets a custom client configuration
func WithConfig(cfg *config.ClientConfig) ClientOption {
	return func(c *Client) {
		c.config = cfg
	}
}

// WithLogger sets a custom logger
func WithLogger(logger *slog.Logger) ClientOption {
	return func(c *Client) {
		c.logger = logger
	}
}

// NewClient creates a new GA4 API client with rate limiting and logging
func NewClient(opts ...ClientOption) (*Client, error) {
	// Default configuration
	cfg := config.DefaultClientConfig()

	// Default logger
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	// Create client with defaults
	client := &Client{
		config: cfg,
		logger: logger,
	}

	// Apply options
	for _, opt := range opts {
		opt(client)
	}

	// Update logger based on config
	client.logger = createLogger(client.config.Logging)

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), client.config.Timeouts.ContextTimeout)
	client.ctx = ctx
	client.cancel = cancel

	// Get credentials from environment
	credsFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if credsFile == "" {
		cancel()
		return nil, fmt.Errorf("GOOGLE_APPLICATION_CREDENTIALS not set")
	}

	client.logger.Debug("initializing GA4 client",
		slog.String("credentials_file", credsFile),
		slog.Float64("rate_limit", client.config.RateLimiting.RequestsPerSecond),
		slog.Int("burst", client.config.RateLimiting.Burst),
	)

	// Create admin service with timeout context
	adminService, err := admin.NewService(ctx, option.WithAuthCredentialsFile(option.ServiceAccount, credsFile))
	if err != nil {
		cancel()
		client.logger.Error("failed to create admin service", slog.String("error", err.Error()))
		return nil, fmt.Errorf("failed to create admin service: %w", err)
	}

	client.admin = adminService

	// Initialize rate limiter
	client.rateLimiter = rate.NewLimiter(
		rate.Limit(client.config.RateLimiting.RequestsPerSecond),
		client.config.RateLimiting.Burst,
	)

	client.logger.Info("GA4 client initialized successfully",
		slog.Float64("rate_limit_rps", client.config.RateLimiting.RequestsPerSecond),
		slog.Int("rate_limit_burst", client.config.RateLimiting.Burst),
		slog.Duration("request_timeout", client.config.Timeouts.RequestTimeout),
	)

	return client, nil
}

// createLogger creates a logger based on the logging configuration
func createLogger(cfg config.LoggingConfig) *slog.Logger {
	var level slog.Level
	switch cfg.Level {
	case "debug":
		level = slog.LevelDebug
	case "info":
		level = slog.LevelInfo
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{
		Level:     level,
		AddSource: cfg.AddSource,
	}

	var handler slog.Handler
	if cfg.Format == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	return slog.New(handler)
}

// Close cancels the client context and cleans up resources
func (c *Client) Close() {
	if c.cancel != nil {
		c.logger.Debug("closing GA4 client")
		c.cancel()
	}
}

// waitForRateLimit waits for rate limiter permission before making an API call
// This ensures we don't exceed Google Analytics API quotas
func (c *Client) waitForRateLimit(ctx context.Context, operation string) error {
	start := time.Now()

	// Create a context with timeout for the individual request
	reqCtx, cancel := context.WithTimeout(ctx, c.config.Timeouts.RequestTimeout)
	defer cancel()

	c.logger.Debug("waiting for rate limit",
		slog.String("operation", operation),
	)

	err := c.rateLimiter.Wait(reqCtx)
	if err != nil {
		c.logger.Error("rate limit wait failed",
			slog.String("operation", operation),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("rate limit wait failed for %s: %w", operation, err)
	}

	waitDuration := time.Since(start)
	if waitDuration > 100*time.Millisecond {
		c.logger.Debug("rate limit wait completed",
			slog.String("operation", operation),
			slog.Duration("wait_duration", waitDuration),
		)
	}

	return nil
}

// GetLogger returns the client's logger for use in other packages
func (c *Client) GetLogger() *slog.Logger {
	return c.logger
}

// ValidatePropertyID validates a property ID using the validation package
func (c *Client) ValidatePropertyID(propertyID string) error {
	return validation.ValidatePropertyID(propertyID)
}
