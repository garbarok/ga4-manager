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

// fakeSearchAPI is a local SearchAPI for the cannibalisation tests. It
// satisfies the slimmed interface (QuerySearchAnalytics only) and reports
// quota by counting calls. Lives in this _test.go file to mirror
// internal/ga4's fakeAdminAPI pattern.
type fakeSearchAPI struct {
	rows  []gsc.SearchAnalyticsRow
	err   error
	calls int
}

func (f *fakeSearchAPI) QuerySearchAnalytics(_ *gsc.SearchAnalyticsQuery) (*gsc.SearchAnalyticsReport, error) {
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

func newParams(t *testing.T, fake *fakeSearchAPI, format string) (cannibalizationParams, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	return cannibalizationParams{
		ConfigPath:     writeConfig(t, "sc-domain:example.com"),
		MinImpressions: 10,
		Format:         format,
		Factory:        func() (gsc.SearchAPI, func(), error) { return fake, func() {}, nil },
		Stdout:         stdout,
		Stderr:         stderr,
		Now:            time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}, stdout, stderr
}

func TestRunCannibalizationCommand_CleanExitOnEmpty(t *testing.T) {
	fake := &fakeSearchAPI{rows: []gsc.SearchAnalyticsRow{
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
	fake := &fakeSearchAPI{rows: []gsc.SearchAnalyticsRow{
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
	fake := &fakeSearchAPI{rows: []gsc.SearchAnalyticsRow{
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
	if len(got.Results[0].Pages) != 2 {
		t.Errorf("results[0].pages len = %d, want 2", len(got.Results[0].Pages))
	}
}

func TestRunCannibalizationCommand_EmptyJSONStillIncludesEnvelope(t *testing.T) {
	fake := &fakeSearchAPI{rows: nil}
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
	fake := &fakeSearchAPI{err: errors.New("api down")}
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
		Stdout:  &bytes.Buffer{},
		Stderr:  &bytes.Buffer{},
		Factory: func() (gsc.SearchAPI, func(), error) { return &fakeSearchAPI{}, func() {}, nil },
		Now:     time.Now(),
	}
	if status := runCannibalizationCommand(params); status != diagcmd.ExitFailure {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitFailure)
	}
}

func TestRunCannibalizationCommand_FailureOnInvalidFormat(t *testing.T) {
	fake := &fakeSearchAPI{rows: nil}
	params, _, stderr := newParams(t, fake, "xml")
	if status := runCannibalizationCommand(params); status != diagcmd.ExitFailure {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitFailure)
	}
	if !strings.Contains(stderr.String(), "invalid --format") {
		t.Errorf("stderr does not explain invalid format: %q", stderr.String())
	}
}
