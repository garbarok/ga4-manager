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

type fakeHealthClient struct {
	results      map[string]gsc.URLInspectionResult
	err          error
	inspectCalls int
}

func (f *fakeHealthClient) InspectURL(_, url string) (*gsc.URLInspectionResult, error) {
	f.inspectCalls++
	if f.err != nil {
		return nil, f.err
	}
	r, ok := f.results[url]
	if !ok {
		// Default to a healthy indexed page when the test didn't override.
		r = gsc.URLInspectionResult{
			URL:               url,
			CoverageState:     "Submitted and indexed",
			IndexingAllowed:   true,
			MobileUsable:      true,
			RichResultsStatus: "PASS",
		}
	}
	return &r, nil
}

func writeHealthConfig(t *testing.T, site string, urls []string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	body := "project:\n  name: example\nsearch_console:\n  site_url: " + site + "\n  url_inspection:\n    priority_urls:\n"
	for _, u := range urls {
		body += "      - " + u + "\n"
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func newHealthParams(t *testing.T, fake *fakeHealthClient, urls []string, format string) (healthParams, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	return healthParams{
		ConfigPath: writeHealthConfig(t, "sc-domain:example.com", urls),
		Format:     format,
		StateDir:   t.TempDir(),
		Factory:    func() (gsc.InspectAPI, func(), error) { return fake, func() {}, nil },
		Stdout:     stdout,
		Stderr:     stderr,
		Now:        time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}, stdout, stderr
}

func TestRunHealthCommand_FirstRunIsSilentBaseline(t *testing.T) {
	fake := &fakeHealthClient{}
	urls := []string{"https://example.com/a", "https://example.com/b"}
	params, stdout, _ := newHealthParams(t, fake, urls, diagcmd.FormatTable)
	if status := runHealthCommand(params); status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitClean)
	}
	// Silent on first run — only the quota footer.
	if got := stdout.String(); got != "quota used: 2\n" {
		t.Errorf("expected only quota footer, got %q", got)
	}
	if fake.inspectCalls != 2 {
		t.Errorf("inspect calls = %d, want 2", fake.inspectCalls)
	}
}

func TestRunHealthCommand_DetectsNoindexRegression(t *testing.T) {
	urls := []string{"https://example.com/a"}

	// First run: indexed and clean — establishes baseline.
	fake := &fakeHealthClient{}
	params, _, _ := newHealthParams(t, fake, urls, diagcmd.FormatJSON)
	if status := runHealthCommand(params); status != diagcmd.ExitClean {
		t.Fatalf("first run status = %d, want clean", status)
	}

	// Second run: same state dir, same site, page now noindexed.
	fake2 := &fakeHealthClient{results: map[string]gsc.URLInspectionResult{
		"https://example.com/a": {
			URL:               "https://example.com/a",
			CoverageState:     "Excluded by 'noindex' tag",
			IndexingAllowed:   false,
			MobileUsable:      true,
			RichResultsStatus: "PASS",
		},
	}}
	params2 := params
	params2.Factory = func() (gsc.InspectAPI, func(), error) { return fake2, func() {}, nil }
	stdout := &bytes.Buffer{}
	params2.Stdout = stdout
	if status := runHealthCommand(params2); status != diagcmd.ExitIssues {
		t.Fatalf("regression run status = %d, want issues", status)
	}

	var got HealthOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if len(got.Results) != 1 {
		t.Fatalf("len(results) = %d, want 1", len(got.Results))
	}
	r := got.Results[0]
	if r.Change != healthChangeRegression {
		t.Errorf("change = %q, want regression", r.Change)
	}
	fields := make([]string, 0, len(r.Changes))
	for _, c := range r.Changes {
		fields = append(fields, c.Field)
	}
	wantFields := []string{"coverage_state", "indexing_allowed"}
	for _, w := range wantFields {
		if !containsField(fields, w) {
			t.Errorf("missing field %q in changes, got %v", w, fields)
		}
	}
}

func TestRunHealthCommand_DetectsRecovery(t *testing.T) {
	urls := []string{"https://example.com/a"}

	// First run: noindexed.
	fake1 := &fakeHealthClient{results: map[string]gsc.URLInspectionResult{
		"https://example.com/a": {
			URL:           "https://example.com/a",
			CoverageState: "Excluded by 'noindex' tag",
		},
	}}
	params, _, _ := newHealthParams(t, fake1, urls, diagcmd.FormatJSON)
	runHealthCommand(params)

	// Second run: same state dir, now healthy.
	fake2 := &fakeHealthClient{results: map[string]gsc.URLInspectionResult{
		"https://example.com/a": {
			URL:               "https://example.com/a",
			CoverageState:     "Submitted and indexed",
			IndexingAllowed:   true,
			MobileUsable:      true,
			RichResultsStatus: "PASS",
		},
	}}
	params2 := params
	params2.Factory = func() (gsc.InspectAPI, func(), error) { return fake2, func() {}, nil }
	stdout := &bytes.Buffer{}
	params2.Stdout = stdout
	// A recovery is not a regression — exit clean.
	if status := runHealthCommand(params2); status != diagcmd.ExitClean {
		t.Fatalf("recovery status = %d, want clean", status)
	}

	var got HealthOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if len(got.Results) != 1 || got.Results[0].Change != healthChangeRecovery {
		t.Errorf("expected one recovery row, got %+v", got.Results)
	}
}

func TestRunHealthCommand_StablePageProducesNoRow(t *testing.T) {
	urls := []string{"https://example.com/a"}
	fake := &fakeHealthClient{}
	params, _, _ := newHealthParams(t, fake, urls, diagcmd.FormatJSON)
	runHealthCommand(params)

	// Second run: identical state — no diff, no row.
	params2 := params
	params2.Factory = func() (gsc.InspectAPI, func(), error) { return fake, func() {}, nil }
	stdout := &bytes.Buffer{}
	params2.Stdout = stdout
	if status := runHealthCommand(params2); status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want clean", status)
	}
	var got HealthOutput
	_ = json.Unmarshal(stdout.Bytes(), &got)
	if len(got.Results) != 0 {
		t.Errorf("stable page should produce no row, got %+v", got.Results)
	}
}

func TestRunHealthCommand_NewURLAfterBaselineSurfacesAsBaseline(t *testing.T) {
	urls := []string{"https://example.com/a"}
	fake := &fakeHealthClient{}
	params, _, _ := newHealthParams(t, fake, urls, diagcmd.FormatJSON)
	runHealthCommand(params)

	// Second run: same state dir, config now has TWO URLs.
	// Re-write the config (different temp config path is fine — same state).
	configPath2 := writeHealthConfig(t, "sc-domain:example.com",
		[]string{"https://example.com/a", "https://example.com/b"})
	params2 := params
	params2.ConfigPath = configPath2
	stdout := &bytes.Buffer{}
	params2.Stdout = stdout
	runHealthCommand(params2)

	var got HealthOutput
	_ = json.Unmarshal(stdout.Bytes(), &got)
	if len(got.Results) != 1 {
		t.Fatalf("expected 1 baseline row, got %d", len(got.Results))
	}
	if got.Results[0].Change != healthChangeBaseline {
		t.Errorf("change = %q, want baseline", got.Results[0].Change)
	}
	if got.Results[0].URL != "https://example.com/b" {
		t.Errorf("baseline URL = %q, want https://example.com/b", got.Results[0].URL)
	}
}

func TestRunHealthCommand_DryRunDoesNotWriteState(t *testing.T) {
	urls := []string{"https://example.com/a"}
	fake := &fakeHealthClient{}
	params, _, _ := newHealthParams(t, fake, urls, diagcmd.FormatJSON)
	params.DryRun = true

	if status := runHealthCommand(params); status != diagcmd.ExitClean {
		t.Fatalf("status = %d", status)
	}

	// State dir should be empty — no file written.
	entries, _ := os.ReadDir(params.StateDir)
	for _, e := range entries {
		if !e.IsDir() {
			t.Errorf("dry-run wrote state file: %s", e.Name())
		}
	}
}

func TestRunHealthCommand_FailureModes(t *testing.T) {
	t.Run("invalid format", func(t *testing.T) {
		fake := &fakeHealthClient{}
		params, _, stderr := newHealthParams(t, fake, []string{"https://x"}, "xml")
		if status := runHealthCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "invalid --format") {
			t.Errorf("stderr missing reason: %q", stderr.String())
		}
	})

	t.Run("missing priority_urls in config", func(t *testing.T) {
		fake := &fakeHealthClient{}
		params, _, stderr := newHealthParams(t, fake, nil, diagcmd.FormatTable)
		if status := runHealthCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "priority_urls") {
			t.Errorf("stderr missing reason: %q", stderr.String())
		}
	})

	t.Run("inspect error", func(t *testing.T) {
		fake := &fakeHealthClient{err: errors.New("api down")}
		params, _, stderr := newHealthParams(t, fake, []string{"https://x"}, diagcmd.FormatTable)
		if status := runHealthCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "api down") {
			t.Errorf("stderr missing reason: %q", stderr.String())
		}
	})
}

func containsField(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
