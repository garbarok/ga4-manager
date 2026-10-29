package cmd

import (
	"fmt"
	"io"
	"os"
	"strconv"
	"time"

	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
	"github.com/garbarok/ga4-manager/internal/gsc/diagnostics"
)

const (
	decayDaysDefault = 28
	decayDaysMin     = 1
	decayDaysMax     = 240 // GSC keeps ~16 months total; allow two ranges back-to-back
	// The current window is fetched in full (up to the API ceiling) so a pair
	// that collapsed to near-zero clicks cannot fall past the cap and vanish.
	// The prior window stays capped: --min-clicks-prior floors it anyway.
	decayCurrentRowLimit = 100000
	decayPriorRowLimit   = 5000
	// GSC final data lags ~2-3 days; both windows end on a finalized day.
	decayDataLagDays = 3
	decayCommandName = "gsc_decay"
)

var (
	gscDecayConfig         string
	gscDecayFormat         string
	gscDecayDays           int
	gscDecayMinClicksPrior int64
	gscDecayMinClicksLost  int64
)

var gscDecayCmd = &cobra.Command{
	Use:   "decay",
	Short: "Detect pages that slipped in position and lost clicks (content decay)",
	Long: `Compare two consecutive windows of Search Console data and surface
(query, page) pairs that slipped in ranking position and lost a meaningful
share of their clicks. Decay is strictly position-driven; clicks lost
through a CTR collapse without position movement are reported by
ctr-anomaly instead.

Predicate (see CONTEXT.md "SEO Diagnostics"):
  position_delta ≥ +1.0 AND clicks_delta ≤ -20%

Both windows end on the last day with final data (3 days back). Two Search
Analytics calls per run (current window + prior window of the same length). Stateless — no state files written.

Each result carries:
  query, page, position_current, position_prior, position_delta,
  clicks_current, clicks_prior, clicks_delta, clicks_lost,
  impressions_current, impressions_prior

Results are sorted by clicks_lost descending, so the biggest losses come first.

Filter knobs:
  --days N             length of each comparison window (default 28)
  --min-clicks-prior N drop pairs whose prior-window click count is below
                       this floor (default 5 — kills long-tail noise)
  --min-clicks-lost N  drop pairs that lost fewer than N clicks (default 0)

Exit codes:
  0  no decay detected
  2  at least one decaying page detected
  1  command failed

Examples:
  ga4 gsc decay --config configs/mysite.yaml
  ga4 gsc decay --config configs/mysite.yaml --format json
  ga4 gsc decay --config configs/mysite.yaml --days 90 --min-clicks-prior 20`,
	RunE: decayRunE,
}

func init() {
	gscCmd.AddCommand(gscDecayCmd)
	gscDecayCmd.Flags().StringVarP(&gscDecayConfig, "config", "c", "", "Path to configuration file (required)")
	gscDecayCmd.Flags().StringVar(&gscDecayFormat, "format", diagcmd.FormatTable, "Output format: table or json")
	gscDecayCmd.Flags().IntVar(&gscDecayDays, "days", decayDaysDefault, "Length of each comparison window in days")
	gscDecayCmd.Flags().Int64Var(&gscDecayMinClicksPrior, "min-clicks-prior", 5, "Drop pairs whose prior-window clicks are below this floor")
	gscDecayCmd.Flags().Int64Var(&gscDecayMinClicksLost, "min-clicks-lost", 0, "Drop pairs that lost fewer than this many clicks")
}

var gscDecayClientFactory = func() (gsc.SearchAPI, func(), error) {
	client, err := gsc.NewClient()
	if err != nil {
		return nil, func() {}, err
	}
	return client, func() { _ = client.Close() }, nil
}

// DecayResultRow is the JSON row for one decaying (query, page) pair.
type DecayResultRow struct {
	Query              string  `json:"query"`
	Page               string  `json:"page"`
	PositionCurrent    float64 `json:"position_current"`
	PositionPrior      float64 `json:"position_prior"`
	PositionDelta      float64 `json:"position_delta"`
	ClicksCurrent      int64   `json:"clicks_current"`
	ClicksPrior        int64   `json:"clicks_prior"`
	ClicksDelta        float64 `json:"clicks_delta"`
	ClicksLost         int64   `json:"clicks_lost"`
	ImpressionsCurrent int64   `json:"impressions_current"`
	ImpressionsPrior   int64   `json:"impressions_prior"`
}

type DecayOutput = diagcmd.Envelope[DecayResultRow]

func decayRunE(_ *cobra.Command, _ []string) error {
	status := runDecayCommand(decayParams{
		ConfigPath:     gscDecayConfig,
		Format:         gscDecayFormat,
		Days:           gscDecayDays,
		MinClicksPrior: gscDecayMinClicksPrior,
		MinClicksLost:  gscDecayMinClicksLost,
		Factory:        gscDecayClientFactory,
		Stdout:         os.Stdout,
		Stderr:         os.Stderr,
		Now:            time.Now().UTC(),
	})
	os.Exit(status)
	return nil
}

type decayParams struct {
	ConfigPath     string
	Format         string
	Days           int
	MinClicksPrior int64
	MinClicksLost  int64
	Factory        func() (gsc.SearchAPI, func(), error)
	Stdout         io.Writer
	Stderr         io.Writer
	Now            time.Time
}

func runDecayCommand(p decayParams) int {
	if err := diagcmd.ValidateFormat(p.Format); err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	if err := validateDecayDays(p.Days); err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	site, _, err := diagcmd.LoadSite(p.ConfigPath)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	client, cleanup, err := p.Factory()
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to create GSC client: %v", err)
	}
	defer cleanup()

	env, err := buildDecayEnvelope(client, site, p.Days, p.MinClicksPrior, p.MinClicksLost, p.Now)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	if err := diagcmd.Render(p.Stdout, env, p.Format, decayColumns, decayTextRow); err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
	}

	return diagcmd.ExitCode(nil, len(env.Results) > 0)
}

func validateDecayDays(days int) error {
	if days < decayDaysMin || days > decayDaysMax {
		return fmt.Errorf("invalid --days %d: must be in [%d, %d]", days, decayDaysMin, decayDaysMax)
	}
	return nil
}

// decayWindows returns (currentStart, currentEnd, priorStart, priorEnd) as
// YYYY-MM-DD strings. Decay compares absolute click totals, so both windows
// must be fully finalized: the current window ends decayDataLagDays back
// (the last day with final data) and both windows span exactly `days` days.
func decayWindows(now time.Time, days int) (string, string, string, string) {
	currentEnd := now.AddDate(0, 0, -decayDataLagDays)
	currentStart := currentEnd.AddDate(0, 0, -(days - 1))
	priorEnd := currentStart.AddDate(0, 0, -1)
	priorStart := priorEnd.AddDate(0, 0, -(days - 1))
	const layout = "2006-01-02"
	return currentStart.Format(layout), currentEnd.Format(layout), priorStart.Format(layout), priorEnd.Format(layout)
}

func buildDecayEnvelope(client gsc.SearchAPI, site string, days int, minClicksPrior, minClicksLost int64, now time.Time) (DecayOutput, error) {
	curStart, curEnd, priorStart, priorEnd := decayWindows(now, days)

	currentReport, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  curStart,
		EndDate:    curEnd,
		Dimensions: []string{"query", "page"},
		RowLimit:   decayCurrentRowLimit,
		DataState:  "final",
	})
	if err != nil {
		return DecayOutput{}, fmt.Errorf("search analytics current window failed: %w", err)
	}

	priorReport, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  priorStart,
		EndDate:    priorEnd,
		Dimensions: []string{"query", "page"},
		RowLimit:   decayPriorRowLimit,
		DataState:  "final",
	})
	if err != nil {
		return DecayOutput{}, fmt.Errorf("search analytics prior window failed: %w", err)
	}

	pairs := joinSearchAnalyticsRows(currentReport.Rows, priorReport.Rows, minClicksPrior)
	byKey := make(map[string]diagnostics.RowPair, len(pairs))
	for _, pair := range pairs {
		byKey[ctrAnomalyKey(pair.Current.Keys)] = pair
	}

	diag := diagnostics.Decay(pairs)
	rows := make([]DecayResultRow, 0, len(diag))
	for _, r := range diag {
		if r.ClicksLost < minClicksLost {
			continue
		}
		pair := byKey[r.Query+"\x00"+r.Page]
		rows = append(rows, DecayResultRow{
			Query:              r.Query,
			Page:               r.Page,
			PositionCurrent:    pair.Current.Position,
			PositionPrior:      pair.Prior.Position,
			PositionDelta:      r.PositionDelta,
			ClicksCurrent:      pair.Current.Clicks,
			ClicksPrior:        pair.Prior.Clicks,
			ClicksDelta:        r.ClicksDelta,
			ClicksLost:         r.ClicksLost,
			ImpressionsCurrent: pair.Current.Impressions,
			ImpressionsPrior:   pair.Prior.Impressions,
		})
	}

	return diagcmd.NewEnvelope(decayCommandName, site, now, rows, priorReport.QuotaUsed), nil
}

var decayColumns = []string{
	"query", "page", "pos", "Δpos", "clicks_now", "clicks_prior", "Δclicks", "clicks_lost",
}

func decayTextRow(r DecayResultRow) []string {
	return []string{
		r.Query,
		r.Page,
		strconv.FormatFloat(r.PositionCurrent, 'f', 1, 64),
		strconv.FormatFloat(r.PositionDelta, 'f', 2, 64),
		strconv.FormatInt(r.ClicksCurrent, 10),
		strconv.FormatInt(r.ClicksPrior, 10),
		strconv.FormatFloat(r.ClicksDelta*100, 'f', 1, 64) + "%",
		strconv.FormatInt(r.ClicksLost, 10),
	}
}
