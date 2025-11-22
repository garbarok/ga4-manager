package config

import (
	"time"
)

// ClientConfig holds configuration for the GA4 API client
type ClientConfig struct {
	// RateLimiting controls API request rate limits
	RateLimiting RateLimitConfig

	// Timeouts controls various timeout settings
	Timeouts TimeoutConfig

	// Logging controls logging behavior
	Logging LoggingConfig
}

// RateLimitConfig holds rate limiting configuration
type RateLimitConfig struct {
	// RequestsPerSecond limits the number of API requests per second
	// Google Analytics Admin API has a default quota of 50 requests per project per second
	// We set a conservative default of 10 to avoid hitting limits
	RequestsPerSecond float64

	// Burst allows a burst of requests up to this limit
	// This allows short bursts while maintaining the average rate
	Burst int
}

// TimeoutConfig holds timeout configuration
type TimeoutConfig struct {
	// RequestTimeout is the timeout for individual API requests
	RequestTimeout time.Duration

	// ContextTimeout is the timeout for the overall client context
	ContextTimeout time.Duration
}

// LoggingConfig holds logging configuration
type LoggingConfig struct {
	// Level sets the logging level: debug, info, warn, error
	Level string

	// Format sets the log format: text or json
	Format string

	// AddSource includes source code position in logs
	AddSource bool
}

// DefaultClientConfig returns the default client configuration
func DefaultClientConfig() *ClientConfig {
	return &ClientConfig{
		RateLimiting: RateLimitConfig{
			RequestsPerSecond: 10.0, // Conservative default for GA4 API
			Burst:             20,   // Allow burst of up to 20 requests
		},
		Timeouts: TimeoutConfig{
			RequestTimeout: 30 * time.Second, // 30 seconds per request
			ContextTimeout: 5 * time.Minute,  // 5 minutes total
		},
		Logging: LoggingConfig{
			Level:     "info",
			Format:    "text",
			AddSource: false,
		},
	}
}

// ProductionClientConfig returns a production-optimized configuration
func ProductionClientConfig() *ClientConfig {
	return &ClientConfig{
		RateLimiting: RateLimitConfig{
			RequestsPerSecond: 5.0, // More conservative for production
			Burst:             10,
		},
		Timeouts: TimeoutConfig{
			RequestTimeout: 30 * time.Second,
			ContextTimeout: 10 * time.Minute,
		},
		Logging: LoggingConfig{
			Level:     "warn", // Less verbose in production
			Format:    "json", // Structured logs for production
			AddSource: true,   // Include source for debugging
		},
	}
}

// DevelopmentClientConfig returns a development-optimized configuration
func DevelopmentClientConfig() *ClientConfig {
	return &ClientConfig{
		RateLimiting: RateLimitConfig{
			RequestsPerSecond: 10.0, // Higher rate for development
			Burst:             30,
		},
		Timeouts: TimeoutConfig{
			RequestTimeout: 60 * time.Second, // Longer timeout for debugging
			ContextTimeout: 15 * time.Minute,
		},
		Logging: LoggingConfig{
			Level:     "debug", // Verbose logging for development
			Format:    "text",  // Human-readable logs
			AddSource: true,    // Include source for debugging
		},
	}
}
