package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
)

// fakeCannibalizationClient implements cannibalizationClient (the union of
// gsc.SearchAPI and gsc.InspectAPI) for the cannibalisation tests. Lives in
// this _test.go file to mirror internal/ga4's fakeAdminAPI pattern.
type fakeCannibalizationClient struct {
	rows           []gsc.SearchAnalyticsRow
	searchErr      error
	searchCalls    int
	coverageByPage map[string]string
	inspectErr     error
	inspectCalls   int
}

func (f *fakeCannibalizationClient) QuerySearchAnalytics(_ *gsc.SearchAnalyticsQuery) (*gsc.SearchAnalyticsReport, error) {
	f.searchCalls++
	if f.searchErr != nil {
		return nil, f.searchErr
	}
	return &gsc.SearchAnalyticsReport{
		Rows:      f.rows,
		TotalRows: len(f.rows),
		QuotaUsed: f.searchCalls,
	}, nil
}

func (f *fakeCannibalizationClient) InspectURL(_, page string) (*gsc.URLInspectionResult, error) {
	f.inspectCalls++
	if f.inspectErr != nil {
		return nil, f.inspectErr
	}
	return &gsc.URLInspectionResult{
		URL:           page,
		CoverageState: f.coverageByPage[page],
	}, nil
}

func writeConfig(t *testing.T, site string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	body := "project:\n  name: example\nsearch_console:\n  site_url: " + site + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func cannibalisationRow(query, page string, impressions int64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{Keys: []string{query, page}, Impressions: impressions}
}

func newParams(t *testing.T, fake *fakeCannibalizationClient, format string) (cannibalizationParams, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	return cannibalizationParams{
		ConfigPath:     writeConfig(t, "sc-domain:example.com"),
		MinImpressions: 10,
		Format:         format,
		Days:           cannibalizationDaysDefault,
		Factory:        func() (cannibalizationClient, func(), error) { return fake, func() {}, nil },
		Stdout:         stdout,
		Stderr:         stderr,
		Now:            time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}, stdout, stderr
}

func TestRunCannibalizationCommand_CleanExitOnEmpty(t *testing.T) {
	fake := &fakeCannibalizationClient{rows: []gsc.SearchAnalyticsRow{
		cannibalisationRow("widgets", "https://example.com/a", 100),
	}}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatTable)

	status := runCannibalizationCommand(params)

	if status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitClean)
	}
	if got := stdout.String(); got != "quota used: 1\n" {
		t.Fatalf("stdout = %q, want only quota footer", got)
	}
}

func TestRunCannibalizationCommand_IssuesExitOnHit(t *testing.T) {
	fake := &fakeCannibalizationClient{rows: []gsc.SearchAnalyticsRow{
		cannibalisationRow("widgets", "https://example.com/a", 50),
		cannibalisationRow("widgets", "https://example.com/b", 30),
	}}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatTable)

	status := runCannibalizationCommand(params)

	if status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}
	out := stdout.String()
	for _, want := range []string{"query", "pages", "total_impressions", "canonical_candidate", "widgets", "https://example.com/a"} {
		if !strings.Contains(out, want) {
			t.Fatalf("text output missing %q: %q", want, out)
		}
	}
	if !strings.HasSuffix(strings.TrimRight(out, "\n"), "quota used: 1") {
		t.Fatalf("text output missing or misplaced quota footer: %q", out)
	}
}

func TestRunCannibalizationCommand_JSONShape(t *testing.T) {
	fake := &fakeCannibalizationClient{rows: []gsc.SearchAnalyticsRow{
		cannibalisationRow("widgets", "https://example.com/a", 50),
		cannibalisationRow("widgets", "https://example.com/b", 30),
		cannibalisationRow("gadgets", "https://example.com/c", 200),
		cannibalisationRow("gadgets", "https://example.com/d", 150),
	}}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatJSON)

	status := runCannibalizationCommand(params)

	if status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}

	var got CannibalizationOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if got.Command != cannibalizationCommandName {
		t.Errorf("command = %q, want %q", got.Command, cannibalizationCommandName)
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
	if len(got.Results) != 2 {
		t.Fatalf("len(results) = %d, want 2", len(got.Results))
	}
	if got.Results[0].Query != "gadgets" {
		t.Errorf("results[0].query = %q, want gadgets (highest total impressions first)", got.Results[0].Query)
	}
	if got.Results[0].TotalImpressions != 350 {
		t.Errorf("results[0].total_impressions = %d, want 350", got.Results[0].TotalImpressions)
	}
	if got.Results[0].CanonicalCandidate != "https://example.com/c" {
		t.Errorf("results[0].canonical_candidate = %q", got.Results[0].CanonicalCandidate)
	}
	if got.Results[0].Severity != "" {
		t.Errorf("severity should be empty when --with-coverage-state is off, got %q", got.Results[0].Severity)
	}
	if got.Results[0].Pages[0].CoverageState != "" {
		t.Errorf("coverage_state should be empty when --with-coverage-state is off, got %q", got.Results[0].Pages[0].CoverageState)
	}
}

func TestRunCannibalizationCommand_EmptyJSONStillIncludesEnvelope(t *testing.T) {
	fake := &fakeCannibalizationClient{rows: nil}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatJSON)

	status := runCannibalizationCommand(params)

	if status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitClean)
	}

	var got CannibalizationOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if got.Results == nil || len(got.Results) != 0 {
		t.Errorf("results should be empty slice, got %#v", got.Results)
	}
	if got.QuotaUsed != 1 {
		t.Errorf("quota_used = %d, want 1", got.QuotaUsed)
	}
}

func TestRunCannibalizationCommand_FailureOnAPIError(t *testing.T) {
	fake := &fakeCannibalizationClient{searchErr: errors.New("api down")}
	params, _, stderr := newParams(t, fake, diagcmd.FormatTable)

	status := runCannibalizationCommand(params)

	if status != diagcmd.ExitFailure {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitFailure)
	}
	if !strings.Contains(stderr.String(), "api down") {
		t.Errorf("stderr does not surface api error: %q", stderr.String())
	}
}

func TestRunCannibalizationCommand_FailureOnMissingConfig(t *testing.T) {
	params := cannibalizationParams{
		Format:  diagcmd.FormatTable,
		Days:    cannibalizationDaysDefault,
		Stdout:  &bytes.Buffer{},
		Stderr:  &bytes.Buffer{},
		Factory: func() (cannibalizationClient, func(), error) { return &fakeCannibalizationClient{}, func() {}, nil },
		Now:     time.Now(),
	}
	if status := runCannibalizationCommand(params); status != diagcmd.ExitFailure {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitFailure)
	}
}

func TestRunCannibalizationCommand_FailureOnInvalidFormat(t *testing.T) {
	fake := &fakeCannibalizationClient{rows: nil}
	params, _, stderr := newParams(t, fake, "xml")
	if status := runCannibalizationCommand(params); status != diagcmd.ExitFailure {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitFailure)
	}
	if !strings.Contains(stderr.String(), "invalid --format") {
		t.Errorf("stderr does not explain invalid format: %q", stderr.String())
	}
}

func TestRunCannibalizationCommand_FailureOnInvalidDays(t *testing.T) {
	fake := &fakeCannibalizationClient{}
	params, _, stderr := newParams(t, fake, diagcmd.FormatTable)
	params.Days = 0
	if status := runCannibalizationCommand(params); status != diagcmd.ExitFailure {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitFailure)
	}
	if !strings.Contains(stderr.String(), "invalid --days") {
		t.Errorf("stderr does not explain invalid days: %q", stderr.String())
	}

	params.Days = cannibalizationDaysMax + 1
	stderr.Reset()
	if status := runCannibalizationCommand(params); status != diagcmd.ExitFailure {
		t.Fatalf("status above max = %d, want %d", status, diagcmd.ExitFailure)
	}
}

func TestRunCannibalizationCommand_WithCoverageStateAddsSeverityAndDedupesInspect(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			cannibalisationRow("widgets", "https://example.com/a", 50),
			cannibalisationRow("widgets", "https://example.com/b", 30),
			cannibalisationRow("gadgets", "https://example.com/a", 40), // page A reused across queries
			cannibalisationRow("gadgets", "https://example.com/c", 25),
		},
		coverageByPage: map[string]string{
			"https://example.com/a": "Page with redirect", // legacy, redirected
			"https://example.com/b": "Submitted and indexed",
			"https://example.com/c": "Submitted and indexed",
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatJSON)
	params.WithCoverageState = true

	status := runCannibalizationCommand(params)
	if status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}

	var got CannibalizationOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}

	// Deduplication: pages {a, b, c} → 3 unique → 3 Inspect calls, NOT 4.
	if fake.inspectCalls != 3 {
		t.Errorf("inspect calls = %d, want 3 (dedup across queries)", fake.inspectCalls)
	}
	// Quota footer: 1 search + 3 inspect = 4.
	if got.QuotaUsed != 4 {
		t.Errorf("quota_used = %d, want 4", got.QuotaUsed)
	}

	// Every result has severity populated, every page has coverage_state.
	for i, r := range got.Results {
		if r.Severity == "" {
			t.Errorf("results[%d].severity is empty", i)
		}
		for j, p := range r.Pages {
			if p.CoverageState == "" {
				t.Errorf("results[%d].pages[%d].coverage_state is empty", i, j)
			}
		}
	}

	// Both queries should be "consolidating" because both share page A (redirect).
	for i, r := range got.Results {
		if r.Severity != SeverityConsolidating {
			t.Errorf("results[%d].severity = %q, want %q (page A redirects in both)", i, r.Severity, SeverityConsolidating)
		}
	}
}

func TestRunCannibalizationCommand_WithCoverageStateActionableWhenNoRedirect(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			cannibalisationRow("widgets", "https://example.com/x", 50),
			cannibalisationRow("widgets", "https://example.com/y", 30),
		},
		coverageByPage: map[string]string{
			"https://example.com/x": "Submitted and indexed",
			"https://example.com/y": "Submitted and indexed",
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatJSON)
	params.WithCoverageState = true

	if status := runCannibalizationCommand(params); status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}

	var got CannibalizationOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if len(got.Results) != 1 {
		t.Fatalf("len(results) = %d, want 1", len(got.Results))
	}
	if got.Results[0].Severity != SeverityActionable {
		t.Errorf("severity = %q, want %q", got.Results[0].Severity, SeverityActionable)
	}
}

func TestRunCannibalizationCommand_WithCoverageStateAddsTableColumn(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			cannibalisationRow("widgets", "https://example.com/x", 50),
			cannibalisationRow("widgets", "https://example.com/y", 30),
		},
		coverageByPage: map[string]string{
			"https://example.com/x": "Submitted and indexed",
			"https://example.com/y": "Submitted and indexed",
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatTable)
	params.WithCoverageState = true

	runCannibalizationCommand(params)
	out := stdout.String()
	if !strings.Contains(out, "severity") {
		t.Errorf("table header missing severity column: %q", out)
	}
	if !strings.Contains(out, SeverityActionable) {
		t.Errorf("table missing actionable severity: %q", out)
	}
}

// Regression test for the operator's BO-04 finding: when a consolidating
// result's impression leader IS the redirected page, canonical_candidate
// must be replaced with the impression leader among NON-redirect pages so
// the Operator never sees "canonicalise to this redirect target" advice.
func TestRunCannibalizationCommand_WithCoverageStateRedirectAwareCanonical(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			// Legacy URL has MORE impressions than the canonical target.
			cannibalisationRow("uk-query", "https://example.com/legacy", 27),
			cannibalisationRow("uk-query", "https://example.com/canonical", 13),
		},
		coverageByPage: map[string]string{
			"https://example.com/legacy":    "Page with redirect",
			"https://example.com/canonical": "Submitted and indexed",
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatJSON)
	params.WithCoverageState = true

	runCannibalizationCommand(params)

	var got CannibalizationOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if len(got.Results) != 1 {
		t.Fatalf("len(results) = %d, want 1", len(got.Results))
	}
	if got.Results[0].Severity != SeverityConsolidating {
		t.Fatalf("severity = %q, want consolidating", got.Results[0].Severity)
	}
	if got.Results[0].CanonicalCandidate != "https://example.com/canonical" {
		t.Errorf("canonical_candidate = %q, want %q (impression-leader among non-redirect pages)",
			got.Results[0].CanonicalCandidate, "https://example.com/canonical")
	}
}

func TestRunCannibalizationCommand_OnlyActionableFiltersConsolidating(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			// Consolidating finding (one side redirects).
			cannibalisationRow("legacy-query", "https://example.com/legacy", 50),
			cannibalisationRow("legacy-query", "https://example.com/new", 30),
			// Actionable finding (both sides indexed).
			cannibalisationRow("hot-query", "https://example.com/a", 40),
			cannibalisationRow("hot-query", "https://example.com/b", 35),
		},
		coverageByPage: map[string]string{
			"https://example.com/legacy": "Page with redirect",
			"https://example.com/new":    "Submitted and indexed",
			"https://example.com/a":      "Submitted and indexed",
			"https://example.com/b":      "Submitted and indexed",
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatJSON)
	params.OnlyActionable = true

	status := runCannibalizationCommand(params)

	var got CannibalizationOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if len(got.Results) != 1 {
		t.Fatalf("len(results) = %d, want 1 (the actionable one)", len(got.Results))
	}
	if got.Results[0].Query != "hot-query" {
		t.Errorf("kept the wrong finding: %q", got.Results[0].Query)
	}
	if got.Results[0].Severity != SeverityActionable {
		t.Errorf("severity = %q, want actionable", got.Results[0].Severity)
	}
	if status != diagcmd.ExitIssues {
		t.Errorf("status = %d, want %d (still issues — one actionable left)", status, diagcmd.ExitIssues)
	}
}

func TestRunCannibalizationCommand_OnlyActionableExitsCleanWhenAllConsolidating(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			cannibalisationRow("q", "https://example.com/legacy", 50),
			cannibalisationRow("q", "https://example.com/new", 30),
		},
		coverageByPage: map[string]string{
			"https://example.com/legacy": "Page with redirect",
			"https://example.com/new":    "Submitted and indexed",
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatJSON)
	params.OnlyActionable = true

	status := runCannibalizationCommand(params)

	if status != diagcmd.ExitClean {
		t.Errorf("status = %d, want %d (everything filtered out → exit clean for cron-friendliness)",
			status, diagcmd.ExitClean)
	}

	var got CannibalizationOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(got.Results) != 0 {
		t.Errorf("results should be empty after --only-actionable filter, got %d", len(got.Results))
	}
}

func TestRunCannibalizationCommand_OnlyActionableImpliesWithCoverageState(t *testing.T) {
	// No coverageByPage map needed — setting --only-actionable alone should
	// still cause Inspect calls because the flag implies --with-coverage-state.
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			cannibalisationRow("q", "https://example.com/a", 50),
			cannibalisationRow("q", "https://example.com/b", 30),
		},
		coverageByPage: map[string]string{
			"https://example.com/a": "Submitted and indexed",
			"https://example.com/b": "Submitted and indexed",
		},
	}
	params, _, _ := newParams(t, fake, diagcmd.FormatJSON)
	params.OnlyActionable = true
	// Intentionally leaving params.WithCoverageState = false.

	runCannibalizationCommand(params)

	if fake.inspectCalls == 0 {
		t.Error("expected --only-actionable to imply --with-coverage-state (Inspect should fire)")
	}
}

func TestRunCannibalizationCommand_TextSummaryFooter(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			cannibalisationRow("q1", "https://example.com/legacy", 50),
			cannibalisationRow("q1", "https://example.com/new", 30),
			cannibalisationRow("q2", "https://example.com/a", 40),
			cannibalisationRow("q2", "https://example.com/b", 35),
		},
		coverageByPage: map[string]string{
			"https://example.com/legacy": "Page with redirect",
			"https://example.com/new":    "Submitted and indexed",
			"https://example.com/a":      "Submitted and indexed",
			"https://example.com/b":      "Submitted and indexed",
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatTable)
	params.WithCoverageState = true

	runCannibalizationCommand(params)
	out := stdout.String()

	if !strings.Contains(out, "→ 2 findings: 1 actionable, 1 consolidating.") {
		t.Errorf("summary footer missing or wrong:\n%s", out)
	}
}

func TestRunCannibalizationCommand_TextSummaryFooterNoActionRequired(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			cannibalisationRow("q", "https://example.com/legacy", 50),
			cannibalisationRow("q", "https://example.com/new", 30),
		},
		coverageByPage: map[string]string{
			"https://example.com/legacy": "Page with redirect",
			"https://example.com/new":    "Submitted and indexed",
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatTable)
	params.WithCoverageState = true

	runCannibalizationCommand(params)
	out := stdout.String()

	if !strings.Contains(out, "No action required") {
		t.Errorf("expected 'No action required' phrasing when all consolidating:\n%s", out)
	}
}

func TestRunCannibalizationCommand_TextSummaryFooterOmittedWithoutCoverageState(t *testing.T) {
	fake := &fakeCannibalizationClient{
		rows: []gsc.SearchAnalyticsRow{
			cannibalisationRow("q", "https://example.com/a", 50),
			cannibalisationRow("q", "https://example.com/b", 30),
		},
	}
	params, stdout, _ := newParams(t, fake, diagcmd.FormatTable)
	// withCoverageState off — no severity, no summary footer.

	runCannibalizationCommand(params)
	out := stdout.String()

	if strings.Contains(out, "→") || strings.Contains(out, "actionable") {
		t.Errorf("summary footer should not appear without --with-coverage-state:\n%s", out)
	}
}
