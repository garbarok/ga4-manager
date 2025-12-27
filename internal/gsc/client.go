package gsc

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"golang.org/x/time/rate"
	"google.golang.org/api/option"
	"google.golang.org/api/searchconsole/v1"

	"github.com/garbarok/ga4-manager/internal/config"
)

// QuotaTracker tracks daily API quota usage
type QuotaTracker struct {
	currentDate       time.Time // Date of current quota period
	inspectionCount   int       // Number of inspections today
	dailyLimit        int       // Maximum inspections per day (2,000 for GSC)
	warningThreshold  int       // Warn at this count (1,500 = 75%)
	criticalThreshold int       // Error at this count (1,900 = 95%)
}

// Client wraps the Google Search Console API service with rate limiting and logging
type Client struct {
	service      *searchconsole.Service
	rateLimiter  *rate.Limiter
	logger       *slog.Logger
	ctx          context.Context
	cancel       context.CancelFunc
	timeout      time.Duration
	quotaTracker *QuotaTracker
}

// ClientOption is a functional option for configuring the Client
type ClientOption func(*Client) error

// NewClient creates a new GSC client with the given options
// Requires GOOGLE_APPLICATION_CREDENTIALS environment variable to be set
func NewClient(opts ...ClientOption) (*Client, error) {
	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)

	// Initialize client with defaults
	client := &Client{
		ctx:     ctx,
		cancel:  cancel,
		timeout: 30 * time.Second,
		// Default rate limiter: 600 requests/minute per property (10 RPS)
		// GSC API limits: 2,000/day, 600/min per property
		rateLimiter: rate.NewLimiter(rate.Limit(10.0), 20),
		logger:      slog.Default(),
		// Initialize quota tracker with GSC daily limits
		quotaTracker: &QuotaTracker{
			currentDate:       time.Now(),
			inspectionCount:   0,
			dailyLimit:        2000, // GSC API limit
			warningThreshold:  1500, // 75% of daily limit
			criticalThreshold: 1900, // 95% of daily limit
		},
	}

	// Apply options
	for _, opt := range opts {
		if err := opt(client); err != nil {
			cancel()
			return nil, fmt.Errorf("failed to apply client option: %w", err)
		}
	}

	// Initialize Search Console service with required scopes
	// Request full access scope for Search Console
	service, err := searchconsole.NewService(ctx, option.WithScopes(searchconsole.WebmastersScope))
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create Search Console service: %w", err)
	}

	client.service = service
	client.logger.Info("GSC client initialized successfully")

	return client, nil
}

// WithConfig applies a configuration to the client
func WithConfig(cfg *config.ClientConfig) ClientOption {
	return func(c *Client) error {
		if cfg == nil {
			return nil
		}

		// Apply rate limiting config
		if cfg.RateLimiting.RequestsPerSecond > 0 {
			c.rateLimiter = rate.NewLimiter(
				rate.Limit(cfg.RateLimiting.RequestsPerSecond),
				cfg.RateLimiting.Burst,
			)
		}

		// Apply timeout config
		if cfg.Timeouts.RequestTimeout > 0 {
			c.timeout = cfg.Timeouts.RequestTimeout
		}
		if cfg.Timeouts.ContextTimeout > 0 {
			// Recreate context with new timeout
			c.cancel()
			c.ctx, c.cancel = context.WithTimeout(context.Background(), cfg.Timeouts.ContextTimeout)
		}

		// Apply logging config
		if cfg.Logging.Level != "" {
			logLevel := slog.LevelInfo
			switch cfg.Logging.Level {
			case "debug":
				logLevel = slog.LevelDebug
			case "info":
				logLevel = slog.LevelInfo
			case "warn":
				logLevel = slog.LevelWarn
			case "error":
				logLevel = slog.LevelError
			}

			opts := &slog.HandlerOptions{
				Level:     logLevel,
				AddSource: cfg.Logging.AddSource,
			}

			var handler slog.Handler
			if cfg.Logging.Format == "json" {
				handler = slog.NewJSONHandler(os.Stdout, opts)
			} else {
				handler = slog.NewTextHandler(os.Stdout, opts)
			}

			c.logger = slog.New(handler)
		}

		return nil
	}
}

// WithCredentials sets custom credentials for the client
func WithCredentials(credentialsJSON string) ClientOption {
	return func(c *Client) error {
		service, err := searchconsole.NewService(c.ctx,
			option.WithCredentialsJSON([]byte(credentialsJSON)),
			option.WithScopes(searchconsole.WebmastersScope))
		if err != nil {
			return fmt.Errorf("failed to create service with credentials: %w", err)
		}
		c.service = service
		return nil
	}
}

// Close closes the client and cancels the context
func (c *Client) Close() error {
	c.cancel()
	c.logger.Info("GSC client closed")
	return nil
}

// waitForRateLimit waits for rate limiter permission before making API call
func (c *Client) waitForRateLimit(operation string) error {
	ctx, cancel := context.WithTimeout(c.ctx, c.timeout)
	defer cancel()

	err := c.rateLimiter.Wait(ctx)
	if err != nil {
		c.logger.Error("rate limit wait failed",
			"operation", operation,
			"error", err)
		return fmt.Errorf("rate limit wait failed for %s: %w", operation, err)
	}

	c.logger.Debug("rate limit check passed", "operation", operation)
	return nil
}

// Service returns the underlying Search Console service for advanced usage
func (c *Client) Service() *searchconsole.Service {
	return c.service
}

// Logger returns the client's logger for external use
func (c *Client) Logger() *slog.Logger {
	return c.logger
}

// Context returns the client's context
func (c *Client) Context() context.Context {
	return c.ctx
}

// checkDailyQuota checks if we've exceeded daily quota limits
// Returns error if critical threshold exceeded, warning if warning threshold exceeded
func (c *Client) checkDailyQuota() error {
	// Check if we need to reset the daily counter (new day)
	now := time.Now()
	if !isSameDay(c.quotaTracker.currentDate, now) {
		c.logger.Info("resetting daily quota counter",
			"previous_date", c.quotaTracker.currentDate.Format("2006-01-02"),
			"new_date", now.Format("2006-01-02"),
			"previous_count", c.quotaTracker.inspectionCount)
		c.quotaTracker.currentDate = now
		c.quotaTracker.inspectionCount = 0
	}

	// Check critical threshold (95% - block operation)
	if c.quotaTracker.inspectionCount >= c.quotaTracker.criticalThreshold {
		c.logger.Error("daily quota critical threshold reached",
			"count", c.quotaTracker.inspectionCount,
			"limit", c.quotaTracker.dailyLimit,
			"threshold", c.quotaTracker.criticalThreshold)
		return fmt.Errorf("daily quota critical threshold reached: %d/%d inspections used (%.0f%%). Please wait until tomorrow to continue",
			c.quotaTracker.inspectionCount,
			c.quotaTracker.dailyLimit,
			float64(c.quotaTracker.inspectionCount)/float64(c.quotaTracker.dailyLimit)*100)
	}

	// Check warning threshold (75% - log warning but allow)
	if c.quotaTracker.inspectionCount >= c.quotaTracker.warningThreshold {
		c.logger.Warn("daily quota warning threshold reached",
			"count", c.quotaTracker.inspectionCount,
			"limit", c.quotaTracker.dailyLimit,
			"threshold", c.quotaTracker.warningThreshold,
			"remaining", c.quotaTracker.dailyLimit-c.quotaTracker.inspectionCount)
		// Don't return error, just log warning
	}

	return nil
}

// incrementQuota increments the daily inspection counter
func (c *Client) incrementQuota() {
	c.quotaTracker.inspectionCount++
	c.logger.Debug("daily quota incremented",
		"count", c.quotaTracker.inspectionCount,
		"limit", c.quotaTracker.dailyLimit,
		"remaining", c.quotaTracker.dailyLimit-c.quotaTracker.inspectionCount)
}

// GetQuotaStatus returns the current quota usage status
func (c *Client) GetQuotaStatus() (used int, limit int, date string) {
	return c.quotaTracker.inspectionCount,
		c.quotaTracker.dailyLimit,
		c.quotaTracker.currentDate.Format("2006-01-02")
}

// isSameDay checks if two times are on the same calendar day (ignoring time)
func isSameDay(t1, t2 time.Time) bool {
	y1, m1, d1 := t1.Date()
	y2, m2, d2 := t2.Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}
