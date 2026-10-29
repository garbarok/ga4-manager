package ga4

import (
	"errors"
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

func sampleDimension() config.DimensionConfig {
	return config.DimensionConfig{
		ParameterName: "user_type",
		DisplayName:   "User Type",
		Description:   "Type of user",
		Scope:         "USER",
	}
}

func TestCreateDimension_CallsAPIWithParentAndPayload(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	err := c.CreateDimension("123456789", sampleDimension())

	require.NoError(t, err)
	assert.Equal(t, 1, fake.createDimCalls)
	assert.Equal(t, "properties/123456789", fake.gotCreateDimParent)
	require.NotNil(t, fake.gotCreateDim)
	assert.Equal(t, "user_type", fake.gotCreateDim.ParameterName)
	assert.Equal(t, "User Type", fake.gotCreateDim.DisplayName)
	assert.Equal(t, "USER", fake.gotCreateDim.Scope)
}

func TestCreateDimension_AlreadyExistsSurfacedAsSentinel(t *testing.T) {
	fake := &fakeAdminAPI{createDimErr: errAlreadyExists}
	c := newTestClient(fake)

	err := c.CreateDimension("123456789", sampleDimension())

	require.ErrorIs(t, err, ErrAlreadyExists)
	assert.Equal(t, 1, fake.createDimCalls)
}

func TestCreateDimension_ValidationRejectedBeforeAPICall(t *testing.T) {
	tests := []struct {
		name string
		mut  func(*config.DimensionConfig)
		prop string
	}{
		{"empty property", func(*config.DimensionConfig) {}, ""},
		{"invalid scope", func(d *config.DimensionConfig) { d.Scope = "PLANET" }, "123456789"},
		{"reserved parameter", func(d *config.DimensionConfig) { d.ParameterName = "google_x" }, "123456789"},
		{"empty display name", func(d *config.DimensionConfig) { d.DisplayName = "" }, "123456789"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeAdminAPI{}
			c := newTestClient(fake)
			dim := sampleDimension()
			tt.mut(&dim)

			err := c.CreateDimension(tt.prop, dim)

			require.Error(t, err)
			assert.Contains(t, err.Error(), "validation failed")
			assert.Equal(t, 0, fake.createDimCalls)
		})
	}
}

func TestCreateDimension_APIErrorWrapped(t *testing.T) {
	fake := &fakeAdminAPI{createDimErr: errors.New("boom")}
	c := newTestClient(fake)

	err := c.CreateDimension("123456789", sampleDimension())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create dimension 'User Type' for property 123456789")
}

func TestListDimensions_ReturnsItems(t *testing.T) {
	fake := &fakeAdminAPI{dimList: []*admin.GoogleAnalyticsAdminV1alphaCustomDimension{
		{Name: "properties/123456789/customDimensions/d1", ParameterName: "user_type"},
	}}
	c := newTestClient(fake)

	got, err := c.ListDimensions("123456789")

	require.NoError(t, err)
	assert.Len(t, got, 1)
	assert.Equal(t, 1, fake.listDimCalls)
}

func TestListDimensions_InvalidPropertyIDRejected(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	_, err := c.ListDimensions("nope")

	require.Error(t, err)
	assert.Equal(t, 0, fake.listDimCalls)
}

func TestListDimensions_APIErrorWrapped(t *testing.T) {
	fake := &fakeAdminAPI{listDimErr: errors.New("api down")}
	c := newTestClient(fake)

	_, err := c.ListDimensions("987654321")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to list dimensions for property 987654321")
}

func TestDeleteDimension_FoundArchivesByResourceName(t *testing.T) {
	fake := &fakeAdminAPI{dimList: []*admin.GoogleAnalyticsAdminV1alphaCustomDimension{
		{Name: "properties/123456789/customDimensions/d1", ParameterName: "user_type"},
	}}
	c := newTestClient(fake)

	err := c.DeleteDimension("123456789", "user_type")

	require.NoError(t, err)
	assert.Equal(t, 1, fake.archiveDimCalls)
	assert.Equal(t, "properties/123456789/customDimensions/d1", fake.gotArchiveDimName)
}

func TestDeleteDimension_NotFound(t *testing.T) {
	fake := &fakeAdminAPI{dimList: nil}
	c := newTestClient(fake)

	err := c.DeleteDimension("123456789", "user_type")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "dimension 'user_type' not found in property 123456789")
	assert.Equal(t, 0, fake.archiveDimCalls)
}

func TestDeleteDimension_InvalidInputsRejected(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	err := c.DeleteDimension("123456789", "google_x")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "validation failed")
	assert.Equal(t, 0, fake.listDimCalls)
}

// dimToSDK maps every config field onto the SDK struct.
func TestDimToSDK(t *testing.T) {
	sdk := dimToSDK(config.DimensionConfig{
		ParameterName: "file_format",
		DisplayName:   "File Format",
		Description:   "Downloaded file format",
		Scope:         "EVENT",
	})
	assert.Equal(t, "file_format", sdk.ParameterName)
	assert.Equal(t, "File Format", sdk.DisplayName)
	assert.Equal(t, "Downloaded file format", sdk.Description)
	assert.Equal(t, "EVENT", sdk.Scope)
}
