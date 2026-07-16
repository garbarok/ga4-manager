package ga4

import (
	"context"
	"errors"
	"io"
	"log/slog"

	"golang.org/x/time/rate"
	admin "google.golang.org/api/analyticsadmin/v1alpha"

	"github.com/garbarok/ga4-manager/internal/config"
)

// errAlreadyExists is an error whose message satisfies isAlreadyExistsError,
// so tests can drive the "already exists → ErrAlreadyExists" create path.
var errAlreadyExists = errors.New("resource already exists")

// fakeAdminAPI is a programmable, in-memory adminAPI for tests. It records the
// calls it receives and returns preconfigured results/errors, letting the
// Client's logic be exercised without a live Google Analytics Admin API.
//
// Only the conversion/dimension/metric operations carry capture + injection
// fields (those are what the symmetric-core tests cover); the remaining
// operations are inert stubs present only to satisfy the interface.
type fakeAdminAPI struct {
	// ConversionEvents
	convList            []*admin.GoogleAnalyticsAdminV1alphaConversionEvent
	createConvErr       error
	listConvErr         error
	deleteConvErr       error
	createConvCalls     int
	listConvCalls       int
	deleteConvCalls     int
	gotCreateConvParent string
	gotCreateConv       *admin.GoogleAnalyticsAdminV1alphaConversionEvent
	gotDeleteConvName   string

	// CustomDimensions
	dimList            []*admin.GoogleAnalyticsAdminV1alphaCustomDimension
	createDimErr       error
	listDimErr         error
	archiveDimErr      error
	createDimCalls     int
	listDimCalls       int
	archiveDimCalls    int
	gotCreateDimParent string
	gotCreateDim       *admin.GoogleAnalyticsAdminV1alphaCustomDimension
	gotArchiveDimName  string

	// CustomMetrics
	metList            []*admin.GoogleAnalyticsAdminV1alphaCustomMetric
	createMetErr       error
	listMetErr         error
	archiveMetErr      error
	createMetCalls     int
	listMetCalls       int
	archiveMetCalls    int
	gotCreateMetParent string
	gotCreateMet       *admin.GoogleAnalyticsAdminV1alphaCustomMetric
	gotArchiveMetName  string
}

// --- ConversionEvents ---

func (f *fakeAdminAPI) createConversionEvent(_ context.Context, parent string, e *admin.GoogleAnalyticsAdminV1alphaConversionEvent) error {
	f.createConvCalls++
	f.gotCreateConvParent = parent
	f.gotCreateConv = e
	return f.createConvErr
}

func (f *fakeAdminAPI) listConversionEvents(_ context.Context, _ string) ([]*admin.GoogleAnalyticsAdminV1alphaConversionEvent, error) {
	f.listConvCalls++
	if f.listConvErr != nil {
		return nil, f.listConvErr
	}
	return f.convList, nil
}

func (f *fakeAdminAPI) deleteConversionEvent(_ context.Context, name string) error {
	f.deleteConvCalls++
	f.gotDeleteConvName = name
	return f.deleteConvErr
}

// --- CustomDimensions ---

func (f *fakeAdminAPI) createCustomDimension(_ context.Context, parent string, d *admin.GoogleAnalyticsAdminV1alphaCustomDimension) error {
	f.createDimCalls++
	f.gotCreateDimParent = parent
	f.gotCreateDim = d
	return f.createDimErr
}

func (f *fakeAdminAPI) listCustomDimensions(_ context.Context, _ string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomDimension, error) {
	f.listDimCalls++
	if f.listDimErr != nil {
		return nil, f.listDimErr
	}
	return f.dimList, nil
}

func (f *fakeAdminAPI) archiveCustomDimension(_ context.Context, name string) error {
	f.archiveDimCalls++
	f.gotArchiveDimName = name
	return f.archiveDimErr
}

// --- CustomMetrics ---

func (f *fakeAdminAPI) createCustomMetric(_ context.Context, parent string, m *admin.GoogleAnalyticsAdminV1alphaCustomMetric) error {
	f.createMetCalls++
	f.gotCreateMetParent = parent
	f.gotCreateMet = m
	return f.createMetErr
}

func (f *fakeAdminAPI) listCustomMetrics(_ context.Context, _ string) ([]*admin.GoogleAnalyticsAdminV1alphaCustomMetric, error) {
	f.listMetCalls++
	if f.listMetErr != nil {
		return nil, f.listMetErr
	}
	return f.metList, nil
}

func (f *fakeAdminAPI) patchCustomMetric(_ context.Context, _ string, _ *admin.GoogleAnalyticsAdminV1alphaCustomMetric) error {
	return nil
}

func (f *fakeAdminAPI) archiveCustomMetric(_ context.Context, name string) error {
	f.archiveMetCalls++
	f.gotArchiveMetName = name
	return f.archiveMetErr
}

// --- Inert stubs (present only to satisfy adminAPI) ---

func (f *fakeAdminAPI) createChannelGroup(context.Context, string, *admin.GoogleAnalyticsAdminV1alphaChannelGroup) (*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	return nil, nil
}
func (f *fakeAdminAPI) listChannelGroups(context.Context, string) ([]*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	return nil, nil
}
func (f *fakeAdminAPI) patchChannelGroup(context.Context, string, *admin.GoogleAnalyticsAdminV1alphaChannelGroup, string) error {
	return nil
}
func (f *fakeAdminAPI) deleteChannelGroup(context.Context, string) error { return nil }
func (f *fakeAdminAPI) getChannelGroup(context.Context, string) (*admin.GoogleAnalyticsAdminV1alphaChannelGroup, error) {
	return nil, nil
}
func (f *fakeAdminAPI) listDataStreams(context.Context, string) ([]*admin.GoogleAnalyticsAdminV1alphaDataStream, error) {
	return nil, nil
}
func (f *fakeAdminAPI) getDataStream(context.Context, string) (*admin.GoogleAnalyticsAdminV1alphaDataStream, error) {
	return nil, nil
}
func (f *fakeAdminAPI) getEnhancedMeasurementSettings(context.Context, string) (*admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings, error) {
	return nil, nil
}
func (f *fakeAdminAPI) updateEnhancedMeasurementSettings(context.Context, string, *admin.GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings, string) error {
	return nil
}
func (f *fakeAdminAPI) listBigQueryLinks(context.Context, string) ([]*admin.GoogleAnalyticsAdminV1alphaBigQueryLink, error) {
	return nil, nil
}
func (f *fakeAdminAPI) getBigQueryLink(context.Context, string) (*admin.GoogleAnalyticsAdminV1alphaBigQueryLink, error) {
	return nil, nil
}
func (f *fakeAdminAPI) getDataRetentionSettings(context.Context, string) (*admin.GoogleAnalyticsAdminV1alphaDataRetentionSettings, error) {
	return nil, nil
}
func (f *fakeAdminAPI) updateDataRetentionSettings(context.Context, string, *admin.GoogleAnalyticsAdminV1alphaDataRetentionSettings, string) error {
	return nil
}

// newTestClient builds a Client backed by the given fake adminAPI, with an
// unlimited rate limiter and a discard logger, so methods run instantly and
// silently in tests.
func newTestClient(api adminAPI) *Client {
	return &Client{
		admin:       api,
		ctx:         context.Background(),
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		rateLimiter: rate.NewLimiter(rate.Inf, 1),
		config:      config.DefaultClientConfig(),
	}
}
