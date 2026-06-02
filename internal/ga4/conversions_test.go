package ga4

import (
	"errors"
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

// Tracer bullet: CreateConversion drives the API with the right parent path and
// payload. Proves the seam + fake + test client wire together end-to-end.
func TestCreateConversion_CallsAPIWithParentAndPayload(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	err := c.CreateConversion("123456789", "purchase", "ONCE_PER_EVENT")

	require.NoError(t, err)
	assert.Equal(t, 1, fake.createConvCalls)
	assert.Equal(t, "properties/123456789", fake.gotCreateConvParent)
	require.NotNil(t, fake.gotCreateConv)
	assert.Equal(t, "purchase", fake.gotCreateConv.EventName)
	assert.Equal(t, "ONCE_PER_EVENT", fake.gotCreateConv.CountingMethod)
}

// An "already exists" API error is idempotent success, not a failure.
func TestCreateConversion_AlreadyExistsTreatedAsSuccess(t *testing.T) {
	fake := &fakeAdminAPI{createConvErr: errAlreadyExists}
	c := newTestClient(fake)

	err := c.CreateConversion("123456789", "purchase", "ONCE_PER_EVENT")

	require.NoError(t, err)
	assert.Equal(t, 1, fake.createConvCalls)
}

// Invalid input is rejected before any API call is made.
func TestCreateConversion_ValidationRejectedBeforeAPICall(t *testing.T) {
	tests := []struct {
		name           string
		propertyID     string
		eventName      string
		countingMethod string
	}{
		{"empty property", "", "purchase", "ONCE_PER_EVENT"},
		{"non-numeric property", "abc", "purchase", "ONCE_PER_EVENT"},
		{"empty event", "123456789", "", "ONCE_PER_EVENT"},
		{"reserved prefix event", "123456789", "google_purchase", "ONCE_PER_EVENT"},
		{"invalid counting method", "123456789", "purchase", "TWICE"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeAdminAPI{}
			c := newTestClient(fake)

			err := c.CreateConversion(tt.propertyID, tt.eventName, tt.countingMethod)

			require.Error(t, err)
			assert.Contains(t, err.Error(), "validation failed")
			assert.Equal(t, 0, fake.createConvCalls, "API must not be called on invalid input")
		})
	}
}

// A non-"already exists" API error is wrapped with resource context.
func TestCreateConversion_APIErrorWrapped(t *testing.T) {
	fake := &fakeAdminAPI{createConvErr: errors.New("boom")}
	c := newTestClient(fake)

	err := c.CreateConversion("123456789", "purchase", "ONCE_PER_EVENT")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create conversion 'purchase' for property 123456789")
	assert.ErrorContains(t, err, "boom")
}

func TestListConversions_ReturnsItems(t *testing.T) {
	fake := &fakeAdminAPI{convList: []*admin.GoogleAnalyticsAdminV1alphaConversionEvent{
		{Name: "properties/123456789/conversionEvents/a", EventName: "a"},
		{Name: "properties/123456789/conversionEvents/b", EventName: "b"},
	}}
	c := newTestClient(fake)

	got, err := c.ListConversions("123456789")

	require.NoError(t, err)
	assert.Len(t, got, 2)
	assert.Equal(t, 1, fake.listConvCalls)
}

func TestListConversions_InvalidPropertyIDRejected(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	_, err := c.ListConversions("not-numeric")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "validation failed")
	assert.Equal(t, 0, fake.listConvCalls)
}

func TestListConversions_APIErrorWrapped(t *testing.T) {
	fake := &fakeAdminAPI{listConvErr: errors.New("api down")}
	c := newTestClient(fake)

	_, err := c.ListConversions("987654321")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to list conversions for property 987654321")
}

func TestDeleteConversion_FoundArchivesByResourceName(t *testing.T) {
	fake := &fakeAdminAPI{convList: []*admin.GoogleAnalyticsAdminV1alphaConversionEvent{
		{Name: "properties/123456789/conversionEvents/xyz", EventName: "old_event"},
	}}
	c := newTestClient(fake)

	err := c.DeleteConversion("123456789", "old_event")

	require.NoError(t, err)
	assert.Equal(t, 1, fake.deleteConvCalls)
	assert.Equal(t, "properties/123456789/conversionEvents/xyz", fake.gotDeleteConvName)
}

func TestDeleteConversion_NotFound(t *testing.T) {
	fake := &fakeAdminAPI{convList: nil}
	c := newTestClient(fake)

	err := c.DeleteConversion("123456789", "missing_event")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "conversion event 'missing_event' not found in property 123456789")
	assert.Equal(t, 0, fake.deleteConvCalls, "delete must not be called when the event is absent")
}

func TestDeleteConversion_InvalidInputsRejected(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	err := c.DeleteConversion("", "old_event")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "validation failed")
	assert.Equal(t, 0, fake.listConvCalls)
}

// conversionToSDK maps every config field onto the SDK struct.
func TestConversionToSDK(t *testing.T) {
	sdk := conversionToSDK(config.ConversionConfig{
		Name:           "purchase",
		CountingMethod: "ONCE_PER_SESSION",
		Description:    "Purchase conversion",
	})
	assert.Equal(t, "purchase", sdk.EventName)
	assert.Equal(t, "ONCE_PER_SESSION", sdk.CountingMethod)
}
