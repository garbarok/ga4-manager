package ga4

import (
	"context"
	"fmt"
	"os"

	admin "google.golang.org/api/analyticsadmin/v1alpha"
	"google.golang.org/api/option"
)

type Client struct {
	admin *admin.Service
	ctx   context.Context
}

func NewClient() (*Client, error) {
	ctx := context.Background()
	
	// Get credentials from environment
	credsFile := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if credsFile == "" {
		return nil, fmt.Errorf("GOOGLE_APPLICATION_CREDENTIALS not set")
	}

	adminService, err := admin.NewService(ctx, option.WithCredentialsFile(credsFile))
	if err != nil {
		return nil, fmt.Errorf("failed to create admin service: %w", err)
	}

	return &Client{
		admin: adminService,
		ctx:   ctx,
	}, nil
}
