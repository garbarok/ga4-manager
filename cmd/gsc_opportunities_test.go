package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
)

// fakeOpportunitiesClient implements gsc.SearchAPI for the opportunities
// command's unit tests.
type fakeOpportunitiesClient struct {
	rows  []gsc.SearchAnalyticsRow
	err   error
	calls int
}

func (f *fakeOpportunitiesClient) QuerySearchAnalytics(_ *gsc.SearchAnalyticsQuery) (*gsc.SearchAnalyticsReport, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return &gsc.SearchAnalyticsReport{
		Rows:      f.rows,
		TotalRows: len(f.rows),
		QuotaUsed: f.calls,
	}, nil
}

func opportunityRow(query, page string, clicks, impressions int64, ctr, position float64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{
		Keys:        []string{query, page},
		Clicks:      clicks,
		Impressions: impressions,
		CTR:         ctr,
		Position:    position,
	}
}

func newOpportunitiesParams(t *testing.T, fake *fakeOpportunitiesClient, format string) (opportunitiesParams, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	return opportunitiesParams{
		ConfigPath:     writeConfig(t, "sc-domain:example.com"),
		Format:         format,
		Days:           opportunitiesDaysDefault,
		MinImpressions: 20,
		Factory:        func() (gsc.SearchAPI, func(), error) { return fake, func() {}, nil },
		Stdout:         stdout,
		Stderr:         stderr,
		Now:            time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}, stdout, stderr
}

func TestRunOpportunitiesCommand_CleanExitWhenNoUnderConverters(t *testing.T) {
	// Every page in the same bucket has the same CTR → no opportunities
	// because the predicate uses strict less-than against the median.
	fake := &fakeOpportunitiesClient{rows: []gsc.SearchAnalyticsRow{
		opportunityRow("q1", "https://example.com/a", 5, 100, 0.05, 7.0),
		opportunityRow("q2", "https://example.com/b", 5, 100, 0.05, 7.0),
		opportunityRow("q3", "https://example.com/c", 5, 100, 0.05, 7.0),
	}}
	params, stdout, _ := newOpportunitiesParams(t, fake, diagcmd.FormatTable)
	if status := runOpportunitiesCommand(params); status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitClean)
	}
	if got := stdout.String(); got != "quota used: 1\n" {
		t.Errorf("expected only quota footer, got %q", got)
	}
}

func TestRunOpportunitiesCommand_RanksByPotentialClicksDesc(t *testing.T) {
	// Three rows in the same bucket. The high-impression under-performer
	// should rank first, even if a low-impression row has a bigger CTR
	// gap in relative terms.
	fake := &fakeOpportunitiesClient{rows: []gsc.SearchAnalyticsRow{
		opportunityRow("big-volume", "https://example.com/big", 10, 1000, 0.01, 7.0),
		opportunityRow("median-page", "https://example.com/median", 100, 1000, 0.10, 7.0),
		opportunityRow("high-volume-upper", "https://example.com/upper", 200, 1000, 0.20, 7.0),
		// A small-impressions row with the SAME CTR as big-volume — same
		// relative gap, but fewer clicks at stake.
		opportunityRow("small-volume", "https://example.com/small", 1, 50, 0.02, 7.0),
	}}
	params, stdout, _ := newOpportunitiesParams(t, fake, diagcmd.FormatJSON)
	if status := runOpportunitiesCommand(params); status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}

	var got OpportunitiesOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if len(got.Results) < 2 {
		t.Fatalf("expected at least 2 results, got %d", len(got.Results))
	}
	if got.Results[0].Query != "big-volume" {
		t.Errorf("first result query = %q, want big-volume (highest potential_clicks)", got.Results[0].Query)
	}
	if got.Results[0].PotentialClicks <= got.Results[1].PotentialClicks {
		t.Errorf("results not sorted by potential_clicks desc: %d vs %d",
			got.Results[0].PotentialClicks, got.Results[1].PotentialClicks)
	}
}

func TestRunOpportunitiesCommand_DropsBelowMinImpressionsBeforeBucketMedian(t *testing.T) {
	// One legitimate row + many tiny noise rows in the same bucket. Without
	// the impression floor the noise rows would drag the bucket median
	// down. With the floor, only the legitimate row survives — single-row
	// bucket falls back to the baseline curve, so the row still surfaces
	// as an opportunity against the baseline (not the noise-polluted site
	// median).
	rows := []gsc.SearchAnalyticsRow{
		opportunityRow("real", "https://example.com/real", 10, 500, 0.02, 8.0),
	}
	for i := 0; i < 30; i++ {
		rows = append(rows, opportunityRow("noise", "https://example.com/noise", 0, 2, 0.0, 8.0))
	}
	fake := &fakeOpportunitiesClient{rows: rows}
	params, stdout, _ := newOpportunitiesParams(t, fake, diagcmd.FormatJSON)
	params.MinImpressions = 20

	if status := runOpportunitiesCommand(params); status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want issues (baseline curve should surface the opportunity)", status)
	}

	var got OpportunitiesOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(got.Results) != 1 {
		t.Fatalf("len(results) = %d, want 1 (single survivor after floor)", len(got.Results))
	}
	if got.Results[0].MedianSource != "baseline" {
		t.Errorf("expected baseline source, got %q (noise rows should not pollute the median)",
			got.Results[0].MedianSource)
	}
}

func TestRunOpportunitiesCommand_MinPotentialClicksFiltersBelowFloor(t *testing.T) {
	fake := &fakeOpportunitiesClient{rows: []gsc.SearchAnalyticsRow{
		// Two clear opportunities: one large (200 potential clicks), one tiny.
		opportunityRow("big", "https://example.com/big", 10, 1000, 0.01, 7.0),
		opportunityRow("median", "https://example.com/median", 100, 1000, 0.10, 7.0),
		// A row that produces a small potential — say impressions=25, gap small.
		opportunityRow("tiny", "https://example.com/tiny", 0, 25, 0.0, 7.0),
	}}
	params, stdout, _ := newOpportunitiesParams(t, fake, diagcmd.FormatJSON)
	params.MinPotentialClicks = 50

	runOpportunitiesCommand(params)
	var got OpportunitiesOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	for _, r := range got.Results {
		if r.PotentialClicks < 50 {
			t.Errorf("result %q has potential_clicks = %d, below floor of 50",
				r.Query, r.PotentialClicks)
		}
	}
}

func TestRunOpportunitiesCommand_JSONShapeFull(t *testing.T) {
	fake := &fakeOpportunitiesClient{rows: []gsc.SearchAnalyticsRow{
		opportunityRow("q1", "https://example.com/a", 10, 1000, 0.01, 7.0),
		opportunityRow("q2", "https://example.com/b", 100, 1000, 0.10, 7.0),
	}}
	params, stdout, _ := newOpportunitiesParams(t, fake, diagcmd.FormatJSON)

	if status := runOpportunitiesCommand(params); status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}

	var got OpportunitiesOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if got.Command != opportunitiesCommandName {
		t.Errorf("command = %q, want %q", got.Command, opportunitiesCommandName)
	}
	if got.Site != "sc-domain:example.com" {
		t.Errorf("site = %q", got.Site)
	}
	if got.GeneratedAt != "2026-06-05T12:00:00Z" {
		t.Errorf("generated_at = %q", got.GeneratedAt)
	}
	if got.QuotaUsed != 1 {
		t.Errorf("quota_used = %d, want 1", got.QuotaUsed)
	}
	if len(got.Results) == 0 {
		t.Fatal("expected at least one opportunity")
	}
	first := got.Results[0]
	if first.Query == "" || first.Page == "" {
		t.Error("query/page empty")
	}
	if first.Impressions == 0 || first.Clicks < 0 {
		t.Errorf("impressions/clicks unexpected: %+v", first)
	}
	if first.PotentialClicks <= 0 {
		t.Errorf("potential_clicks should be positive for qualifying row: %d", first.PotentialClicks)
	}
	if first.CTRGap <= 0 {
		t.Errorf("ctr_gap should be positive: %f", first.CTRGap)
	}
	if first.Bucket < 5 || first.Bucket > 20 {
		t.Errorf("bucket %d outside [5, 20]", first.Bucket)
	}
}

func TestRunOpportunitiesCommand_FailureModes(t *testing.T) {
	t.Run("invalid format", func(t *testing.T) {
		fake := &fakeOpportunitiesClient{}
		params, _, stderr := newOpportunitiesParams(t, fake, "xml")
		if status := runOpportunitiesCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "invalid --format") {
			t.Errorf("stderr missing format reason: %q", stderr.String())
		}
	})

	t.Run("invalid days", func(t *testing.T) {
		fake := &fakeOpportunitiesClient{}
		params, _, stderr := newOpportunitiesParams(t, fake, diagcmd.FormatTable)
		params.Days = 0
		if status := runOpportunitiesCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "invalid --days") {
			t.Errorf("stderr missing days reason: %q", stderr.String())
		}
	})

	t.Run("api error", func(t *testing.T) {
		fake := &fakeOpportunitiesClient{err: errors.New("api down")}
		params, _, stderr := newOpportunitiesParams(t, fake, diagcmd.FormatTable)
		if status := runOpportunitiesCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "api down") {
			t.Errorf("stderr missing api error: %q", stderr.String())
		}
	})

	t.Run("missing config", func(t *testing.T) {
		params := opportunitiesParams{
			Format:  diagcmd.FormatTable,
			Days:    opportunitiesDaysDefault,
			Stdout:  &bytes.Buffer{},
			Stderr:  &bytes.Buffer{},
			Factory: func() (gsc.SearchAPI, func(), error) { return &fakeOpportunitiesClient{}, func() {}, nil },
			Now:     time.Now(),
		}
		if status := runOpportunitiesCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
	})
}
