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

// fakeCTRAnomalyClient returns canned rows. Because the command makes two
// QuerySearchAnalytics calls (current + prior windows), the fake exposes
// two row slices and tracks which call it is on.
type fakeCTRAnomalyClient struct {
	currentRows []gsc.SearchAnalyticsRow
	priorRows   []gsc.SearchAnalyticsRow
	err         error
	calls       int
}

func (f *fakeCTRAnomalyClient) QuerySearchAnalytics(_ *gsc.SearchAnalyticsQuery) (*gsc.SearchAnalyticsReport, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	var rows []gsc.SearchAnalyticsRow
	if f.calls == 1 {
		rows = f.currentRows
	} else {
		rows = f.priorRows
	}
	return &gsc.SearchAnalyticsReport{
		Rows:      rows,
		TotalRows: len(rows),
		QuotaUsed: f.calls,
	}, nil
}

func ctrAnomalyRow(query, page string, clicks, impressions int64, ctr, position float64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{
		Keys:        []string{query, page},
		Clicks:      clicks,
		Impressions: impressions,
		CTR:         ctr,
		Position:    position,
	}
}

func newCTRAnomalyParams(t *testing.T, fake *fakeCTRAnomalyClient, format string) (ctrAnomalyParams, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	return ctrAnomalyParams{
		ConfigPath:     writeConfig(t, "sc-domain:example.com"),
		Format:         format,
		Days:           ctrAnomalyDaysDefault,
		MinClicksPrior: 5,
		Factory:        func() (gsc.SearchAPI, func(), error) { return fake, func() {}, nil },
		Stdout:         stdout,
		Stderr:         stderr,
		Now:            time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
	}, stdout, stderr
}

func TestRunCTRAnomalyCommand_CleanExitWhenNoCollapses(t *testing.T) {
	// Same row in both windows → ctr_delta = 0 → no anomaly.
	row := ctrAnomalyRow("q", "https://example.com/p", 100, 1000, 0.10, 7.0)
	fake := &fakeCTRAnomalyClient{
		currentRows: []gsc.SearchAnalyticsRow{row},
		priorRows:   []gsc.SearchAnalyticsRow{row},
	}
	params, stdout, _ := newCTRAnomalyParams(t, fake, diagcmd.FormatTable)
	if status := runCTRAnomalyCommand(params); status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitClean)
	}
	if got := stdout.String(); got != "quota used: 2\n" {
		t.Errorf("expected only quota footer, got %q", got)
	}
}

func TestRunCTRAnomalyCommand_DetectsSnippetCollapse(t *testing.T) {
	// Position unchanged (7.0 → 7.2), CTR halved → exceeds the −30% threshold.
	current := ctrAnomalyRow("compound-interest", "https://example.com/calc", 30, 1000, 0.03, 7.2)
	prior := ctrAnomalyRow("compound-interest", "https://example.com/calc", 80, 1000, 0.08, 7.0)
	fake := &fakeCTRAnomalyClient{
		currentRows: []gsc.SearchAnalyticsRow{current},
		priorRows:   []gsc.SearchAnalyticsRow{prior},
	}
	params, stdout, _ := newCTRAnomalyParams(t, fake, diagcmd.FormatJSON)
	if status := runCTRAnomalyCommand(params); status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}

	var got CTRAnomalyOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
	}
	if len(got.Results) != 1 {
		t.Fatalf("len(results) = %d, want 1", len(got.Results))
	}
	r := got.Results[0]
	if r.Query != "compound-interest" || r.Page != "https://example.com/calc" {
		t.Errorf("wrong identity: %+v", r)
	}
	if r.ClicksLost != 50 {
		t.Errorf("clicks_lost = %d, want 50", r.ClicksLost)
	}
	if r.CTRDelta > -0.30 {
		t.Errorf("ctr_delta = %f, expected ≤ -0.30", r.CTRDelta)
	}
	if r.PositionDelta > 1.0 || r.PositionDelta < -1.0 {
		t.Errorf("position_delta = %f, expected |x| < 1.0", r.PositionDelta)
	}
	if got.QuotaUsed != 2 {
		t.Errorf("quota_used = %d, want 2 (two analytics calls)", got.QuotaUsed)
	}
}

func TestRunCTRAnomalyCommand_SortsByClicksLostDesc(t *testing.T) {
	current := []gsc.SearchAnalyticsRow{
		ctrAnomalyRow("small", "https://example.com/s", 2, 100, 0.02, 5.0),
		ctrAnomalyRow("big", "https://example.com/b", 50, 5000, 0.01, 5.0),
		ctrAnomalyRow("mid", "https://example.com/m", 10, 1000, 0.01, 5.0),
	}
	prior := []gsc.SearchAnalyticsRow{
		ctrAnomalyRow("small", "https://example.com/s", 10, 100, 0.10, 5.0),
		ctrAnomalyRow("big", "https://example.com/b", 400, 5000, 0.08, 5.0),
		ctrAnomalyRow("mid", "https://example.com/m", 80, 1000, 0.08, 5.0),
	}
	fake := &fakeCTRAnomalyClient{currentRows: current, priorRows: prior}
	params, stdout, _ := newCTRAnomalyParams(t, fake, diagcmd.FormatJSON)
	if status := runCTRAnomalyCommand(params); status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}
	var got CTRAnomalyOutput
	_ = json.Unmarshal(stdout.Bytes(), &got)
	if len(got.Results) != 3 {
		t.Fatalf("got %d results, want 3", len(got.Results))
	}
	if got.Results[0].Query != "big" {
		t.Errorf("first should be 'big' (350 lost), got %q", got.Results[0].Query)
	}
	if got.Results[1].Query != "mid" {
		t.Errorf("second should be 'mid' (70 lost), got %q", got.Results[1].Query)
	}
}

func TestRunCTRAnomalyCommand_SkipsRowsMissingInOneWindow(t *testing.T) {
	current := []gsc.SearchAnalyticsRow{
		ctrAnomalyRow("only-current", "https://example.com/c", 5, 1000, 0.005, 7.0),
		ctrAnomalyRow("both", "https://example.com/b", 5, 1000, 0.005, 7.0),
	}
	prior := []gsc.SearchAnalyticsRow{
		ctrAnomalyRow("only-prior", "https://example.com/p", 80, 1000, 0.08, 7.0),
		ctrAnomalyRow("both", "https://example.com/b", 80, 1000, 0.08, 7.0),
	}
	fake := &fakeCTRAnomalyClient{currentRows: current, priorRows: prior}
	params, stdout, _ := newCTRAnomalyParams(t, fake, diagcmd.FormatJSON)
	runCTRAnomalyCommand(params)
	var got CTRAnomalyOutput
	_ = json.Unmarshal(stdout.Bytes(), &got)
	if len(got.Results) != 1 {
		t.Fatalf("got %d results, want 1 (only 'both' present in both windows)", len(got.Results))
	}
	if got.Results[0].Query != "both" {
		t.Errorf("kept the wrong query: %q", got.Results[0].Query)
	}
}

func TestRunCTRAnomalyCommand_MinClicksPriorDropsNoise(t *testing.T) {
	// Prior clicks = 1 → below the floor of 5 → pair dropped.
	current := []gsc.SearchAnalyticsRow{
		ctrAnomalyRow("noise", "https://example.com/n", 0, 100, 0.0, 7.0),
	}
	prior := []gsc.SearchAnalyticsRow{
		ctrAnomalyRow("noise", "https://example.com/n", 1, 100, 0.01, 7.0),
	}
	fake := &fakeCTRAnomalyClient{currentRows: current, priorRows: prior}
	params, stdout, _ := newCTRAnomalyParams(t, fake, diagcmd.FormatJSON)
	if status := runCTRAnomalyCommand(params); status != diagcmd.ExitClean {
		t.Fatalf("expected clean exit (noise dropped), got %d", status)
	}
	_ = stdout
}

func TestRunCTRAnomalyCommand_MinClicksLostFiltersBelowFloor(t *testing.T) {
	current := []gsc.SearchAnalyticsRow{
		ctrAnomalyRow("big", "https://example.com/b", 0, 5000, 0.0, 5.0),
		ctrAnomalyRow("tiny", "https://example.com/t", 0, 100, 0.0, 5.0),
	}
	prior := []gsc.SearchAnalyticsRow{
		ctrAnomalyRow("big", "https://example.com/b", 400, 5000, 0.08, 5.0),
		ctrAnomalyRow("tiny", "https://example.com/t", 8, 100, 0.08, 5.0),
	}
	fake := &fakeCTRAnomalyClient{currentRows: current, priorRows: prior}
	params, stdout, _ := newCTRAnomalyParams(t, fake, diagcmd.FormatJSON)
	params.MinClicksLost = 50
	runCTRAnomalyCommand(params)
	var got CTRAnomalyOutput
	_ = json.Unmarshal(stdout.Bytes(), &got)
	for _, r := range got.Results {
		if r.ClicksLost < 50 {
			t.Errorf("result %q has clicks_lost = %d, below floor of 50", r.Query, r.ClicksLost)
		}
	}
}

func TestRunCTRAnomalyCommand_Windows(t *testing.T) {
	// 2026-06-05 → currentEnd should be 2026-06-04 (yesterday), 28-day window
	// → currentStart = 2026-05-08; priorEnd = 2026-05-07; priorStart = 2026-04-10.
	cs, ce, ps, pe := ctrAnomalyWindows(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC), 28)
	if cs != "2026-05-08" || ce != "2026-06-04" {
		t.Errorf("current window = %s..%s, want 2026-05-08..2026-06-04", cs, ce)
	}
	if ps != "2026-04-10" || pe != "2026-05-07" {
		t.Errorf("prior window = %s..%s, want 2026-04-10..2026-05-07", ps, pe)
	}
}

func TestRunCTRAnomalyCommand_FailureModes(t *testing.T) {
	t.Run("invalid format", func(t *testing.T) {
		fake := &fakeCTRAnomalyClient{}
		params, _, stderr := newCTRAnomalyParams(t, fake, "xml")
		if status := runCTRAnomalyCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "invalid --format") {
			t.Errorf("stderr missing reason: %q", stderr.String())
		}
	})
	t.Run("invalid days", func(t *testing.T) {
		fake := &fakeCTRAnomalyClient{}
		params, _, stderr := newCTRAnomalyParams(t, fake, diagcmd.FormatTable)
		params.Days = 0
		if status := runCTRAnomalyCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "invalid --days") {
			t.Errorf("stderr missing reason: %q", stderr.String())
		}
	})
	t.Run("api error on current window", func(t *testing.T) {
		fake := &fakeCTRAnomalyClient{err: errors.New("api down")}
		params, _, stderr := newCTRAnomalyParams(t, fake, diagcmd.FormatTable)
		if status := runCTRAnomalyCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "api down") {
			t.Errorf("stderr missing reason: %q", stderr.String())
		}
	})
}
