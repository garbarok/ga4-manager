package cmd

import (
	"fmt"

	"github.com/garbarok/ga4-manager/internal/ga4"
)

// newGA4Client constructs a GA4 Admin API client, wrapping construction failures
// with a uniform message. Callers own the returned client's lifecycle and must
// defer client.Close().
//
// (No GSC equivalent: every gsc.NewClient call site already constructs and
// closes its client consistently, so a wrapper would add indirection without
// removing duplication.)
func newGA4Client() (*ga4.Client, error) {
	client, err := ga4.NewClient()
	if err != nil {
		return nil, fmt.Errorf("failed to create GA4 client: %w", err)
	}
	return client, nil
}
