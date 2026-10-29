package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
)

// Reuses fakeCTRAnomalyClient (current + prior call sequence) and ctrAnomalyRow.

func newDecayParams(t *testing.T, fake *fakeCTRAnomalyClient, format string) (decayParams, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	return decayParams{
		ConfigPath:     writeConfig(t, "sc-domain:example.com"),
		Format:         format,
		Days:           decayDaysDefault,
		MinClicksPrior: 5,
		Factory:        func() (gsc.SearchAPI, func(), error) { return fake, func() {}, nil },
		Stdout:         stdout,
		Stderr:         stderr,
		Now:            time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC),
	}, stdout, stderr
}

func TestRunDecayCommand_Table(t *testing.T) {
	const page = "https://example.com/p"
	tests := []struct {
		name      string
		current   []gsc.SearchAnalyticsRow
		prior     []gsc.SearchAnalyticsRow
		minLost   int64
		wantExit  int
		wantQuery []string // expected order
	}{
		{
			name:     "no change is clean",
			current:  []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 100, 1000, 0.1, 5.0)},
			prior:    []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 100, 1000, 0.1, 5.0)},
			wantExit: diagcmd.ExitClean,
		},
		{
			name:      "slipped and lost clicks",
			current:   []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 50, 1000, 0.05, 7.0)},
			prior:     []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 100, 1000, 0.1, 5.0)},
			wantExit:  diagcmd.ExitIssues,
			wantQuery: []string{"q"},
		},
		{
			name:     "lost clicks without position slip is not decay",
			current:  []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 50, 1000, 0.05, 5.2)},
			prior:    []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 100, 1000, 0.1, 5.0)},
			wantExit: diagcmd.ExitClean,
		},
		{
			name:     "slipped but clicks held",
			current:  []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 95, 1000, 0.095, 7.0)},
			prior:    []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 100, 1000, 0.1, 5.0)},
			wantExit: diagcmd.ExitClean,
		},
		{
			name:     "below min-clicks-prior floor is dropped",
			current:  []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 0, 100, 0, 9.0)},
			prior:    []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", page, 2, 100, 0.02, 5.0)},
			wantExit: diagcmd.ExitClean,
		},
		{
			name: "ordered by clicks lost",
			current: []gsc.SearchAnalyticsRow{
				ctrAnomalyRow("small", page, 4, 100, 0.04, 8.0),
				ctrAnomalyRow("big", page, 100, 5000, 0.02, 8.0),
			},
			prior: []gsc.SearchAnalyticsRow{
				ctrAnomalyRow("small", page, 10, 100, 0.1, 5.0),
				ctrAnomalyRow("big", page, 400, 5000, 0.08, 5.0),
			},
			wantExit:  diagcmd.ExitIssues,
			wantQuery: []string{"big", "small"},
		},
		{
			name: "min-clicks-lost filters small losses",
			current: []gsc.SearchAnalyticsRow{
				ctrAnomalyRow("small", page, 4, 100, 0.04, 8.0),
				ctrAnomalyRow("big", page, 100, 5000, 0.02, 8.0),
			},
			prior: []gsc.SearchAnalyticsRow{
				ctrAnomalyRow("small", page, 10, 100, 0.1, 5.0),
				ctrAnomalyRow("big", page, 400, 5000, 0.08, 5.0),
			},
			minLost:   50,
			wantExit:  diagcmd.ExitIssues,
			wantQuery: []string{"big"},
		},
		{
			name:     "pair in one window only is skipped",
			current:  []gsc.SearchAnalyticsRow{ctrAnomalyRow("a", page, 10, 100, 0.1, 9.0)},
			prior:    []gsc.SearchAnalyticsRow{ctrAnomalyRow("b", page, 100, 100, 1, 5.0)},
			wantExit: diagcmd.ExitClean,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeCTRAnomalyClient{currentRows: tc.current, priorRows: tc.prior}
			params, stdout, _ := newDecayParams(t, fake, diagcmd.FormatJSON)
			params.MinClicksLost = tc.minLost
			if status := runDecayCommand(params); status != tc.wantExit {
				t.Fatalf("status = %d, want %d", status, tc.wantExit)
			}
			var got DecayOutput
			if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
				t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
			}
			if got.Command != "gsc_decay" {
				t.Errorf("command = %q", got.Command)
			}
			if len(got.Results) != len(tc.wantQuery) {
				t.Fatalf("len(results) = %d, want %d", len(got.Results), len(tc.wantQuery))
			}
			for i, q := range tc.wantQuery {
				if got.Results[i].Query != q {
					t.Errorf("results[%d].query = %q, want %q", i, got.Results[i].Query, q)
				}
			}
			if got.QuotaUsed != 2 {
				t.Errorf("quota_used = %d, want 2", got.QuotaUsed)
			}
		})
	}
}

func TestRunDecayCommand_RowFields(t *testing.T) {
	fake := &fakeCTRAnomalyClient{
		currentRows: []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", "https://example.com/p", 50, 900, 0.05, 7.0)},
		priorRows:   []gsc.SearchAnalyticsRow{ctrAnomalyRow("q", "https://example.com/p", 100, 1000, 0.1, 5.0)},
	}
	params, stdout, _ := newDecayParams(t, fake, diagcmd.FormatJSON)
	runDecayCommand(params)
	var got DecayOutput
	_ = json.Unmarshal(stdout.Bytes(), &got)
	r := got.Results[0]
	if r.PositionCurrent != 7.0 || r.PositionPrior != 5.0 || r.PositionDelta != 2.0 {
		t.Errorf("positions wrong: %+v", r)
	}
	if r.ClicksCurrent != 50 || r.ClicksPrior != 100 || r.ClicksLost != 50 || r.ClicksDelta != -0.5 {
		t.Errorf("clicks wrong: %+v", r)
	}
	if r.ImpressionsCurrent != 900 || r.ImpressionsPrior != 1000 {
		t.Errorf("impressions wrong: %+v", r)
	}
}

func TestRunDecayCommand_Failures(t *testing.T) {
	t.Run("invalid days", func(t *testing.T) {
		params, _, stderr := newDecayParams(t, &fakeCTRAnomalyClient{}, diagcmd.FormatJSON)
		params.Days = 0
		if status := runDecayCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d, want %d", status, diagcmd.ExitFailure)
		}
		if !strings.Contains(stderr.String(), "--days") {
			t.Errorf("stderr = %q", stderr.String())
		}
	})
	t.Run("invalid format", func(t *testing.T) {
		params, _, _ := newDecayParams(t, &fakeCTRAnomalyClient{}, "xml")
		if status := runDecayCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
	})
	t.Run("api error", func(t *testing.T) {
		fake := &fakeCTRAnomalyClient{err: errors.New("boom")}
		params, _, stderr := newDecayParams(t, fake, diagcmd.FormatJSON)
		if status := runDecayCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
		if !strings.Contains(stderr.String(), "boom") {
			t.Errorf("stderr = %q", stderr.String())
		}
	})
	t.Run("client factory error", func(t *testing.T) {
		params, _, _ := newDecayParams(t, &fakeCTRAnomalyClient{}, diagcmd.FormatJSON)
		params.Factory = func() (gsc.SearchAPI, func(), error) { return nil, func() {}, errors.New("no creds") }
		if status := runDecayCommand(params); status != diagcmd.ExitFailure {
			t.Fatalf("status = %d", status)
		}
	})
}

// capturingDecayClient records each query and honours RowLimit like the real
// API (rows arrive sorted by clicks descending, truncated at the limit).
type capturingDecayClient struct {
	currentRows []gsc.SearchAnalyticsRow
	priorRows   []gsc.SearchAnalyticsRow
	queries     []gsc.SearchAnalyticsQuery
}

func (c *capturingDecayClient) QuerySearchAnalytics(q *gsc.SearchAnalyticsQuery) (*gsc.SearchAnalyticsReport, error) {
	c.queries = append(c.queries, *q)
	rows := c.priorRows
	if len(c.queries) == 1 {
		rows = c.currentRows
	}
	if len(rows) > q.RowLimit {
		rows = rows[:q.RowLimit]
	}
	return &gsc.SearchAnalyticsReport{Rows: rows, TotalRows: len(rows), QuotaUsed: len(c.queries)}, nil
}

func TestDecayWindows_EqualLengthAndFinalized(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	for _, days := range []int{1, 28, 90} {
		fake := &capturingDecayClient{}
		params, _, _ := newDecayParams(t, &fakeCTRAnomalyClient{}, diagcmd.FormatJSON)
		params.Days = days
		params.Factory = func() (gsc.SearchAPI, func(), error) { return fake, func() {}, nil }
		runDecayCommand(params)
		if len(fake.queries) != 2 {
			t.Fatalf("days=%d: got %d queries, want 2", days, len(fake.queries))
		}
		parse := func(s string) time.Time {
			d, err := time.Parse("2006-01-02", s)
			if err != nil {
				t.Fatal(err)
			}
			return d
		}
		cur, prior := fake.queries[0], fake.queries[1]
		curLen := parse(cur.EndDate).Sub(parse(cur.StartDate))
		priorLen := parse(prior.EndDate).Sub(parse(prior.StartDate))
		if curLen != priorLen {
			t.Errorf("days=%d: window lengths differ: %v vs %v", days, curLen, priorLen)
		}
		if want := now.AddDate(0, 0, -decayDataLagDays).Format("2006-01-02"); cur.EndDate != want {
			t.Errorf("days=%d: current end = %s, want finalized day %s", days, cur.EndDate, want)
		}
		if parse(prior.EndDate).AddDate(0, 0, 1) != parse(cur.StartDate) {
			t.Errorf("days=%d: windows not adjacent: prior ends %s, current starts %s", days, prior.EndDate, cur.StartDate)
		}
	}
}

func TestRunDecayCommand_DecayedPairPastPriorCapIsKept(t *testing.T) {
	const page = "https://example.com/p"
	// Current window: more rows than the prior cap, the collapsed pair last
	// (lowest clicks). It must still be fetched and reported.
	current := make([]gsc.SearchAnalyticsRow, 0, decayPriorRowLimit+10)
	for i := 0; i < decayPriorRowLimit+9; i++ {
		current = append(current, ctrAnomalyRow("filler"+strconv.Itoa(i), page, 1000, 10000, 0.1, 3.0))
	}
	current = append(current, ctrAnomalyRow("collapsed", page, 1, 500, 0.002, 9.0))
	prior := []gsc.SearchAnalyticsRow{ctrAnomalyRow("collapsed", page, 40, 500, 0.08, 4.0)}

	fake := &capturingDecayClient{currentRows: current, priorRows: prior}
	params, stdout, _ := newDecayParams(t, &fakeCTRAnomalyClient{}, diagcmd.FormatJSON)
	params.Factory = func() (gsc.SearchAPI, func(), error) { return fake, func() {}, nil }
	if status := runDecayCommand(params); status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}
	var got DecayOutput
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Results) != 1 || got.Results[0].Query != "collapsed" {
		t.Fatalf("results = %+v, want the collapsed pair", got.Results)
	}
}
