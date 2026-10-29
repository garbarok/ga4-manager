package ga4

import (
	"context"

	admin "google.golang.org/api/analyticsadmin/v1alpha"
)

// adminAPI is a narrow consumer interface over the Google Analytics Admin SDK
// (analyticsadmin/v1alpha). It declares only the operations this package
// actually uses, so the client's logic — validation, rate limiting, parent-path
// construction, "already exists" handling, error wrapping, find-then-delete —
// can be exercised in tests with a fake implementation, without a live API.
//
// It is deliberately defined over the SDK's own request/response types so the
// real implementation (realAdminAPI) is pure delegation with no remapping.
// Methods take a context and return the values their callers actually consume
// (creates/updates whose result is discarded return only error).
type adminAPI interface {
	// ConversionEvents
	createConversionEvent(ctx context.Context, parent string, e *admin.GoogleAnalyticsAdminV1alphaConversionEvent) error
	listConversionEvents(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaConversionEvent, error)
	deleteConversionEvent(ctx context.Context, name string) error

	// CustomDimensions
	createCustomDimension(ctx context.Context, parent string, d *admin.GoogleAnalyticsAdminV1alphaCustomDimension) error
	listCustomDimensions(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomDimension, error)
	archiveCustomDimension(ctx context.Context, name string) error

	// CustomMetrics
	createCustomMetric(ctx context.Context, parent string, m *admin.GoogleAnalyticsAdminV1alphaCustomMetric) error
	listCustomMetrics(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomMetric, error)
	patchCustomMetric(ctx context.Context, name string, m *admin.GoogleAnalyticsAdminV1alphaCustomMetric) error
	archiveCustomMetric(ctx context.Context, name string) error

	// ChannelGroups
	createChannelGroup(ctx context.Context, parent string, g *admin.GoogleAnalyticsAdminV1alphaChannelGroup) (*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error)
	listChannelGroups(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error)
	patchChannelGroup(ctx context.Context, name string, g *admin.GoogleAnalyticsAdminV1alphaChannelGroup, updateMask string) error
	deleteChannelGroup(ctx context.Context, name string) error
	getChannelGroup(ctx context.Context, name string) (*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error)

	// DataStreams + enhanced measurement
	listDataStreams(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaDataStream, error)
	getDataStream(ctx context.Context, name string) (*admin.GoogleAnalyticsAdminV1alphaDataStream, error)
	getEnhancedMeasurementSettings(ctx context.Context, settingsPath string) (*admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings, error)
	updateEnhancedMeasurementSettings(ctx context.Context, settingsPath string, s *admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings, updateMask string) error

	// BigQueryLinks
	listBigQueryLinks(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaBigQueryLink, error)
	getBigQueryLink(ctx context.Context, name string) (*admin.GoogleAnalyticsAdminV1alphaBigQueryLink, error)

	// Properties-level data retention
	getDataRetentionSettings(ctx context.Context, name string) (*admin.GoogleAnalyticsAdminV1alphaDataRetentionSettings, error)
	updateDataRetentionSettings(ctx context.Context, name string, s *admin.GoogleAnalyticsAdminV1alphaDataRetentionSettings, updateMask string) error
}

// realAdminAPI is the production adminAPI backed by a live *admin.Service. Every
// method is a one-line delegation to the SDK's fluent builder, threading the
// context and any fixed query options (PageSize, UpdateMask) the callers need.
type realAdminAPI struct {
	svc *admin.Service
}

func (a *realAdminAPI) createConversionEvent(ctx context.Context, parent string, e *admin.GoogleAnalyticsAdminV1alphaConversionEvent) error {
	_, err := a.svc.Properties.ConversionEvents.Create(parent, e).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) listConversionEvents(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaConversionEvent, error) {
	resp, err := a.svc.Properties.ConversionEvents.List(parent).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	return resp.ConversionEvents, nil
}

func (a *realAdminAPI) deleteConversionEvent(ctx context.Context, name string) error {
	_, err := a.svc.Properties.ConversionEvents.Delete(name).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) createCustomDimension(ctx context.Context, parent string, d *admin.GoogleAnalyticsAdminV1alphaCustomDimension) error {
	_, err := a.svc.Properties.CustomDimensions.Create(parent, d).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) listCustomDimensions(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomDimension, error) {
	resp, err := a.svc.Properties.CustomDimensions.List(parent).PageSize(200).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	return resp.CustomDimensions, nil
}

func (a *realAdminAPI) archiveCustomDimension(ctx context.Context, name string) error {
	_, err := a.svc.Properties.CustomDimensions.Archive(name, &admin.GoogleAnalyticsAdminV1alphaArchiveCustomDimensionRequest{}).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) createCustomMetric(ctx context.Context, parent string, m *admin.GoogleAnalyticsAdminV1alphaCustomMetric) error {
	_, err := a.svc.Properties.CustomMetrics.Create(parent, m).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) listCustomMetrics(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomMetric, error) {
	resp, err := a.svc.Properties.CustomMetrics.List(parent).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	return resp.CustomMetrics, nil
}

func (a *realAdminAPI) patchCustomMetric(ctx context.Context, name string, m *admin.GoogleAnalyticsAdminV1alphaCustomMetric) error {
	_, err := a.svc.Properties.CustomMetrics.Patch(name, m).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) archiveCustomMetric(ctx context.Context, name string) error {
	_, err := a.svc.Properties.CustomMetrics.Archive(name, &admin.GoogleAnalyticsAdminV1alphaArchiveCustomMetricRequest{}).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) createChannelGroup(ctx context.Context, parent string, g *admin.GoogleAnalyticsAdminV1alphaChannelGroup) (*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	return a.svc.Properties.ChannelGroups.Create(parent, g).Context(ctx).Do()
}

func (a *realAdminAPI) listChannelGroups(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	resp, err := a.svc.Properties.ChannelGroups.List(parent).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	return resp.ChannelGroups, nil
}

func (a *realAdminAPI) patchChannelGroup(ctx context.Context, name string, g *admin.GoogleAnalyticsAdminV1alphaChannelGroup, updateMask string) error {
	_, err := a.svc.Properties.ChannelGroups.Patch(name, g).UpdateMask(updateMask).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) deleteChannelGroup(ctx context.Context, name string) error {
	_, err := a.svc.Properties.ChannelGroups.Delete(name).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) getChannelGroup(ctx context.Context, name string) (*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	return a.svc.Properties.ChannelGroups.Get(name).Context(ctx).Do()
}

func (a *realAdminAPI) listDataStreams(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaDataStream, error) {
	resp, err := a.svc.Properties.DataStreams.List(parent).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	return resp.DataStreams, nil
}

func (a *realAdminAPI) getDataStream(ctx context.Context, name string) (*admin.GoogleAnalyticsAdminV1alphaDataStream, error) {
	return a.svc.Properties.DataStreams.Get(name).Context(ctx).Do()
}

func (a *realAdminAPI) getEnhancedMeasurementSettings(ctx context.Context, settingsPath string) (*admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings, error) {
	return a.svc.Properties.DataStreams.GetEnhancedMeasurementSettings(settingsPath).Context(ctx).Do()
}

func (a *realAdminAPI) updateEnhancedMeasurementSettings(ctx context.Context, settingsPath string, s *admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings, updateMask string) error {
	_, err := a.svc.Properties.DataStreams.UpdateEnhancedMeasurementSettings(settingsPath, s).UpdateMask(updateMask).Context(ctx).Do()
	return err
}

func (a *realAdminAPI) listBigQueryLinks(ctx context.Context, parent string) ([]*admin.GoogleAnalyticsAdminV1alphaBigQueryLink, error) {
	resp, err := a.svc.Properties.BigQueryLinks.List(parent).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	return resp.BigqueryLinks, nil
}

func (a *realAdminAPI) getBigQueryLink(ctx context.Context, name string) (*admin.GoogleAnalyticsAdminV1alphaBigQueryLink, error) {
	return a.svc.Properties.BigQueryLinks.Get(name).Context(ctx).Do()
}

func (a *realAdminAPI) getDataRetentionSettings(ctx context.Context, name string) (*admin.GoogleAnalyticsAdminV1alphaDataRetentionSettings, error) {
	return a.svc.Properties.GetDataRetentionSettings(name).Context(ctx).Do()
}

func (a *realAdminAPI) updateDataRetentionSettings(ctx context.Context, name string, s *admin.GoogleAnalyticsAdminV1alphaDataRetentionSettings, updateMask string) error {
	_, err := a.svc.Properties.UpdateDataRetentionSettings(name, s).UpdateMask(updateMask).Context(ctx).Do()
	return err
}
