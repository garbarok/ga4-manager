package ga4

import (
	"errors"
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

func sampleMetric() config.MetricConfig {
	return config.MetricConfig{
		ParameterName:   "load_time",
		DisplayName:     "Load Time",
		Description:     "Page load time",
		MeasurementUnit: "STANDARD",
		Scope:           "EVENT",
	}
}

func TestCreateCustomMetric_CallsAPIWithParentAndPayload(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	err := c.CreateCustomMetric("123456789", sampleMetric())

	require.NoError(t, err)
	assert.Equal(t, 1, fake.createMetCalls)
	assert.Equal(t, "properties/123456789", fake.gotCreateMetParent)
	require.NotNil(t, fake.gotCreateMet)
	assert.Equal(t, "load_time", fake.gotCreateMet.ParameterName)
	assert.Equal(t, "Load Time", fake.gotCreateMet.DisplayName)
	assert.Equal(t, "STANDARD", fake.gotCreateMet.MeasurementUnit)
	assert.Equal(t, "EVENT", fake.gotCreateMet.Scope)
}

func TestCreateCustomMetric_AlreadyExistsTreatedAsSuccess(t *testing.T) {
	fake := &fakeAdminAPI{createMetErr: errAlreadyExists}
	c := newTestClient(fake)

	err := c.CreateCustomMetric("123456789", sampleMetric())

	require.NoError(t, err)
	assert.Equal(t, 1, fake.createMetCalls)
}

func TestCreateCustomMetric_ValidationRejectedBeforeAPICall(t *testing.T) {
	tests := []struct {
		name string
		mut  func(*config.MetricConfig)
		prop string
	}{
		{"empty property", func(*config.MetricConfig) {}, ""},
		{"reserved parameter", func(m *config.MetricConfig) { m.ParameterName = "ga_x" }, "123456789"},
		{"empty display name", func(m *config.MetricConfig) { m.DisplayName = "" }, "123456789"},
		{"invalid measurement unit", func(m *config.MetricConfig) { m.MeasurementUnit = "BANANAS" }, "123456789"},
		{"invalid scope", func(m *config.MetricConfig) { m.Scope = "PLANET" }, "123456789"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeAdminAPI{}
			c := newTestClient(fake)
			m := sampleMetric()
			tt.mut(&m)

			err := c.CreateCustomMetric(tt.prop, m)

			require.Error(t, err)
			assert.Contains(t, err.Error(), "validation failed")
			assert.Equal(t, 0, fake.createMetCalls)
		})
	}
}

func TestCreateCustomMetric_APIErrorWrapped(t *testing.T) {
	fake := &fakeAdminAPI{createMetErr: errors.New("boom")}
	c := newTestClient(fake)

	err := c.CreateCustomMetric("123456789", sampleMetric())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create custom metric 'Load Time' for property 123456789")
}

func TestListCustomMetrics_ReturnsItems(t *testing.T) {
	fake := &fakeAdminAPI{metList: []*admin.GoogleAnalyticsAdminV1alphaCustomMetric{
		{Name: "properties/123456789/customMetrics/m1", ParameterName: "load_time"},
	}}
	c := newTestClient(fake)

	got, err := c.ListCustomMetrics("123456789")

	require.NoError(t, err)
	assert.Len(t, got, 1)
	assert.Equal(t, 1, fake.listMetCalls)
}

func TestListCustomMetrics_InvalidPropertyIDRejected(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	_, err := c.ListCustomMetrics("nope")

	require.Error(t, err)
	assert.Equal(t, 0, fake.listMetCalls)
}

func TestListCustomMetrics_APIErrorWrapped(t *testing.T) {
	fake := &fakeAdminAPI{listMetErr: errors.New("api down")}
	c := newTestClient(fake)

	_, err := c.ListCustomMetrics("987654321")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to list custom metrics for property 987654321")
}

func TestDeleteMetric_FoundArchivesByResourceName(t *testing.T) {
	fake := &fakeAdminAPI{metList: []*admin.GoogleAnalyticsAdminV1alphaCustomMetric{
		{Name: "properties/123456789/customMetrics/m1", ParameterName: "load_time"},
	}}
	c := newTestClient(fake)

	err := c.DeleteMetric("123456789", "load_time")

	require.NoError(t, err)
	assert.Equal(t, 1, fake.archiveMetCalls)
	assert.Equal(t, "properties/123456789/customMetrics/m1", fake.gotArchiveMetName)
}

func TestDeleteMetric_NotFound(t *testing.T) {
	fake := &fakeAdminAPI{metList: nil}
	c := newTestClient(fake)

	err := c.DeleteMetric("123456789", "load_time")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "custom metric with parameter 'load_time' not found in property 123456789")
	assert.Equal(t, 0, fake.archiveMetCalls)
}

func TestDeleteMetric_InvalidInputsRejected(t *testing.T) {
	fake := &fakeAdminAPI{}
	c := newTestClient(fake)

	err := c.DeleteMetric("123456789", "ga_x")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "validation failed")
	assert.Equal(t, 0, fake.listMetCalls)
}

// metricToSDK: non-CURRENCY metrics must NOT carry a RestrictedMetricType.
func TestMetricToSDK_StandardHasNoRestrictedType(t *testing.T) {
	sdk := metricToSDK(sampleMetric())
	assert.Equal(t, "load_time", sdk.ParameterName)
	assert.Empty(t, sdk.RestrictedMetricType)
}

// metricToSDK: CURRENCY metrics default to REVENUE_DATA when unset.
func TestMetricToSDK_CurrencyDefaultsToRevenue(t *testing.T) {
	m := sampleMetric()
	m.MeasurementUnit = "CURRENCY"
	sdk := metricToSDK(m)
	assert.Equal(t, []string{"REVENUE_DATA"}, sdk.RestrictedMetricType)
}

// metricToSDK: an explicit RestrictedMetricType is honored for CURRENCY metrics.
func TestMetricToSDK_CurrencyHonorsExplicitType(t *testing.T) {
	m := sampleMetric()
	m.MeasurementUnit = "CURRENCY"
	m.RestrictedMetricType = "COST_DATA"
	sdk := metricToSDK(m)
	assert.Equal(t, []string{"COST_DATA"}, sdk.RestrictedMetricType)
}
