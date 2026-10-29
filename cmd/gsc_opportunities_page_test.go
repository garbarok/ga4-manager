package cmd

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
)

// fakeDimensionClient answers by requested dimensions and reports QuotaUsed
// as a running total, like the real client.
type fakeDimensionClient struct {
	byDims  map[string][]gsc.SearchAnalyticsRow
	queries []*gsc.SearchAnalyticsQuery
}

func (f *fakeDimensionClient) QuerySearchAnalytics(q *gsc.SearchAnalyticsQuery) (*gsc.SearchAnalyticsReport, error) {
	f.queries = append(f.queries, q)
	rows := f.byDims[strings.Join(q.Dimensions, ",")]
	return &gsc.SearchAnalyticsReport{Rows: rows, TotalRows: len(rows), QuotaUsed: len(f.queries)}, nil
}

func pageLevelRow(page string, clicks, impressions int64, position float64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{
		Keys:        []string{page},
		Clicks:      clicks,
		Impressions: impressions,
		CTR:         float64(clicks) / float64(impressions),
		Position:    position,
	}
}

// longTailPageClient models the motivating case: the calculator page has
// 100k impressions at 8.8; the homepage and a 30-impression legal page share
// bucket 9. Only 15k of the calculator's impressions are disclosed per query.
func longTailPageClient() *fakeDimensionClient {
	calc := "https://www.x.app/calculator/mortgage-calculator"
	return &fakeDimensionClient{byDims: map[string][]gsc.SearchAnalyticsRow{
		"page": {
			pageLevelRow(calc, 500, 100000, 8.8),
			pageLevelRow("https://www.x.app/", 160, 2000, 9.4),
			pageLevelRow("https://www.x.app/disclaimer", 0, 30, 8.9),
		},
		"query,page": {
			opportunityRow("mortgage calculator", calc, 50, 10000, 0.005, 9.7),
			opportunityRow("home loan calculator", calc, 12, 5000, 0.0024, 9.2),
			opportunityRow("example site", "https://www.x.app/", 17, 180, 0.094, 2.3),
		},
	}}
}

func runPageMode(t *testing.T, fake *fakeDimensionClient, minImpressions int64) (int, OpportunitiesOutput, string) {
	t.Helper()
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	status := runOpportunitiesCommand(opportunitiesParams{
		ConfigPath:     writeConfig(t, "sc-domain:x.app"),
		Format:         diagcmd.FormatJSON,
		Days:           90,
		MinImpressions: minImpressions,
		Granularity:    granularityPage,
		Factory:        func() (gsc.SearchAPI, func(), error) { return fake, func() {}, nil },
		Stdout:         stdout,
		Stderr:         stderr,
		Now:            time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC),
	})
	var env OpportunitiesOutput
	if status != diagcmd.ExitFailure {
		if err := json.Unmarshal(stdout.Bytes(), &env); err != nil {
			t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
		}
	}
	return status, env, stderr.String()
}

func TestPageOpportunities_SurfacesLongTailPage(t *testing.T) {
	fake := longTailPageClient()
	status, env, _ := runPageMode(t, fake, 50)
	if status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}
	if len(env.Results) == 0 || env.Results[0].Page != "https://www.x.app/calculator/mortgage-calculator" {
		t.Fatalf("first result should be the calculator page, got %+v", env.Results)
	}
	r := env.Results[0]
	if r.Query != "" {
		t.Errorf("query = %q, want empty in page mode", r.Query)
	}
	if r.MedianSource != "baseline" {
		t.Errorf("median_source = %q, want baseline (only 2 peers after the floor)", r.MedianSource)
	}
	if r.AnonymizedShare == nil || *r.AnonymizedShare < 0.849 || *r.AnonymizedShare > 0.851 {
		t.Errorf("anonymized_share = %v, want 0.85", r.AnonymizedShare)
	}
	if r.TopQueries == nil || len(*r.TopQueries) != 2 || (*r.TopQueries)[0].Query != "mortgage calculator" {
		t.Errorf("top_queries = %+v", r.TopQueries)
	}
	if env.QuotaUsed != 2 {
		t.Errorf("quota_used = %d, want 2", env.QuotaUsed)
	}
}

func TestPageOpportunities_LegalPageBelowFloorIsNotAPeer(t *testing.T) {
	_, env, _ := runPageMode(t, longTailPageClient(), 50)
	for _, r := range env.Results {
		if r.Page == "https://www.x.app/disclaimer" {
			t.Errorf("legal page below the impression floor must not appear")
		}
	}
	if len(env.Results) == 0 || env.Results[0].Page != "https://www.x.app/calculator/mortgage-calculator" {
		t.Fatalf("with the floor the calculator must surface first, got %+v", env.Results)
	}
}

// With the CLI's default floor (5) the 0-CTR legal page counts as a peer and
// makes bucket 9's site median the calculator's own CTR. The baseline floor
// must still surface the calculator — this is the motivating case.
func TestPageOpportunities_DefaultFloorStillSurfacesCalculator(t *testing.T) {
	_, env, _ := runPageMode(t, longTailPageClient(), 5)
	if len(env.Results) == 0 || env.Results[0].Page != "https://www.x.app/calculator/mortgage-calculator" {
		t.Fatalf("calculator must be the first result, got %+v", env.Results)
	}
	if env.Results[0].MedianSource != "baseline" {
		t.Errorf("median_source = %q, want baseline", env.Results[0].MedianSource)
	}
}

func TestPageOpportunities_RequestsPageThenQueryPage(t *testing.T) {
	fake := longTailPageClient()
	runPageMode(t, fake, 50)
	if len(fake.queries) != 2 {
		t.Fatalf("calls = %d, want 2", len(fake.queries))
	}
	if got := strings.Join(fake.queries[0].Dimensions, ","); got != "page" {
		t.Errorf("first call dims = %q, want page", got)
	}
	if got := strings.Join(fake.queries[1].Dimensions, ","); got != "query,page" {
		t.Errorf("second call dims = %q, want query,page", got)
	}
}

func TestPageOpportunities_EmptyTopQueriesStillEmitted(t *testing.T) {
	fake := longTailPageClient()
	fake.byDims["query,page"] = nil
	_, env, _ := runPageMode(t, fake, 50)
	if len(env.Results) == 0 {
		t.Fatal("expected results")
	}
	r := env.Results[0]
	if r.TopQueries == nil || len(*r.TopQueries) != 0 {
		t.Errorf("top_queries should be an empty array, got %v", r.TopQueries)
	}
	if r.AnonymizedShare == nil || *r.AnonymizedShare != 1 {
		t.Errorf("anonymized_share = %v, want 1 when nothing is disclosed", r.AnonymizedShare)
	}
}

func TestQueryOpportunities_OmitsPageOnlyFields(t *testing.T) {
	fake := &fakeOpportunitiesClient{rows: []gsc.SearchAnalyticsRow{
		opportunityRow("q", "https://example.com/a", 1, 1000, 0.001, 7.0),
	}}
	params, stdout, _ := newOpportunitiesParams(t, fake, diagcmd.FormatJSON)
	runOpportunitiesCommand(params)
	if strings.Contains(stdout.String(), "top_queries") || strings.Contains(stdout.String(), "anonymized_share") {
		t.Errorf("query mode must not emit page-only fields:\n%s", stdout.String())
	}
}

func TestOpportunities_RejectsUnknownGranularity(t *testing.T) {
	stderr := &bytes.Buffer{}
	status := runOpportunitiesCommand(opportunitiesParams{
		ConfigPath:  writeConfig(t, "sc-domain:x.app"),
		Format:      diagcmd.FormatJSON,
		Days:        28,
		Granularity: "site",
		Stdout:      &bytes.Buffer{},
		Stderr:      stderr,
	})
	if status != diagcmd.ExitFailure || !strings.Contains(stderr.String(), "granularity") {
		t.Errorf("status = %d, stderr = %q", status, stderr.String())
	}
}
