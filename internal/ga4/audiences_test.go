package ga4

import (
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/stretchr/testify/assert"
)

// TestSetupAudiences verifies SetupAudiences is a no-op — GA4 Admin API does not
// support creating audiences programmatically. It must return nil (not an error)
// and silently skip all entries.
func TestSetupAudiences(t *testing.T) {
	ctx, cancel := NewTestContext()
	defer cancel()

	client := &Client{ctx: ctx, cancel: cancel}

	audiences := []config.AudienceConfig{
		{Name: "returning_users", Description: "Users who returned", Duration: 30},
		{Name: "new_users", Duration: 7},
	}

	err := client.SetupAudiences("123456789", audiences)
	assert.NoError(t, err)
}

// TestSetupAudiences_Empty verifies SetupAudiences handles an empty slice.
func TestSetupAudiences_Empty(t *testing.T) {
	ctx, cancel := NewTestContext()
	defer cancel()

	client := &Client{ctx: ctx, cancel: cancel}

	err := client.SetupAudiences("123456789", []config.AudienceConfig{})
	assert.NoError(t, err)
}

// TestAudienceConfigFields verifies AudienceConfig fields are accessible.
// GA4 Admin API does not support creating audiences programmatically;
// AudienceConfig is used for documentation generation only.
func TestAudienceConfigFields(t *testing.T) {
	tests := []struct {
		name     string
		audience config.AudienceConfig
	}{
		{
			name: "all_fields_populated",
			audience: config.AudienceConfig{
				Name:        "returning_users",
				Description: "Users who returned within 30 days",
				Duration:    30,
				Conditions:  []string{"session_count > 1"},
			},
		},
		{
			name: "minimal_audience",
			audience: config.AudienceConfig{
				Name:     "new_users",
				Duration: 7,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.NotEmpty(t, tt.audience.Name)
			assert.Greater(t, tt.audience.Duration, 0)
		})
	}
}
