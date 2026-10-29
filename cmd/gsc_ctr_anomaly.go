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
	ctrAnomalyDaysDefault = 28
	ctrAnomalyDaysMin     = 1
	ctrAnomalyDaysMax     = 240 // GSC keeps ~16 months total; allow two ranges back-to-back
	ctrAnomalyRowLimit    = 5000
	ctrAnomalyCommandName = "gsc_ctr_anomaly"
)

var (
	gscCTRAnomalyConfig         string
	gscCTRAnomalyFormat         string
	gscCTRAnomalyDays           int
	gscCTRAnomalyMinClicksPrior int64
	gscCTRAnomalyMinClicksLost  int64
)

var gscCTRAnomalyCmd = &cobra.Command{
	Use:   "ctr-anomaly",
	Short: "Detect pages whose rank held but CTR collapsed (snippet rot)",
	Long: `Compare two consecutive windows of Search Console data and surface
(query, page) pairs whose ranking position barely moved but whose CTR
dropped sharply. These are snippet-driven regressions — the page is
still ranking, but its title/meta stopped converting. Always actionable
by a title/meta rewrite.

Predicate (see CONTEXT.md "SEO Diagnostics"):
  |position_delta| < 1.0 AND ctr_delta ≤ -30%

Two Search Analytics calls per run (current window + prior window of the
same length). Stateless — no state files written.

Each result carries the per-window numbers needed for an LLM consumer to
prioritise and rewrite:
  query, page, position_current, position_prior, position_delta,
  ctr_current, ctr_prior, ctr_delta, clicks_current, clicks_prior,
  clicks_lost, impressions_current, impressions_prior

Results are sorted by clicks_lost descending — the absolute revenue
impact of the snippet regression — so the biggest losses come first.

Filter knobs:
  --days N             length of each comparison window (default 28)
  --min-clicks-prior N drop pairs whose prior-window click count is below
                       this floor (default 5 — kills long-tail noise)
  --min-clicks-lost N  drop pairs that lost fewer than N clicks
                       (default 0 — show everything that satisfies the
                       predicate)

Exit codes:
  0  no CTR anomalies detected
  2  at least one CTR anomaly detected
  1  command failed

Examples:
  ga4 gsc ctr-anomaly --config configs/mysite.yaml
  ga4 gsc ctr-anomaly --config configs/mysite.yaml --format json
  ga4 gsc ctr-anomaly --config configs/mysite.yaml --days 90 --min-clicks-prior 20`,
	RunE: ctrAnomalyRunE,
}

func init() {
	gscCmd.AddCommand(gscCTRAnomalyCmd)
	gscCTRAnomalyCmd.Flags().StringVarP(&gscCTRAnomalyConfig, "config", "c", "", "Path to configuration file (required)")
	gscCTRAnomalyCmd.Flags().StringVar(&gscCTRAnomalyFormat, "format", diagcmd.FormatTable, "Output format: table or json")
	gscCTRAnomalyCmd.Flags().IntVar(&gscCTRAnomalyDays, "days", ctrAnomalyDaysDefault, "Length of each comparison window in days")
	gscCTRAnomalyCmd.Flags().Int64Var(&gscCTRAnomalyMinClicksPrior, "min-clicks-prior", 5, "Drop pairs whose prior-window clicks are below this floor")
	gscCTRAnomalyCmd.Flags().Int64Var(&gscCTRAnomalyMinClicksLost, "min-clicks-lost", 0, "Drop pairs that lost fewer than this many clicks")
}

var gscCTRAnomalyClientFactory = func() (gsc.SearchAPI, func(), error) {
	client, err := gsc.NewClient()
	if err != nil {
		return nil, func() {}, err
	}
	return client, func() { _ = client.Close() }, nil
}

// CTRAnomalyResultRow mirrors the diagnostic result with explicit JSON tags.
type CTRAnomalyResultRow struct {
	Query              string  `json:"query"`
	Page               string  `json:"page"`
	PositionCurrent    float64 `json:"position_current"`
	PositionPrior      float64 `json:"position_prior"`
	PositionDelta      float64 `json:"position_delta"`
	CTRCurrent         float64 `json:"ctr_current"`
	CTRPrior           float64 `json:"ctr_prior"`
	CTRDelta           float64 `json:"ctr_delta"`
	ClicksCurrent      int64   `json:"clicks_current"`
	ClicksPrior        int64   `json:"clicks_prior"`
	ClicksLost         int64   `json:"clicks_lost"`
	ImpressionsCurrent int64   `json:"impressions_current"`
	ImpressionsPrior   int64   `json:"impressions_prior"`
}

type CTRAnomalyOutput = diagcmd.Envelope[CTRAnomalyResultRow]

func ctrAnomalyRunE(_ *cobra.Command, _ []string) error {
	status := runCTRAnomalyCommand(ctrAnomalyParams{
		ConfigPath:     gscCTRAnomalyConfig,
		Format:         gscCTRAnomalyFormat,
		Days:           gscCTRAnomalyDays,
		MinClicksPrior: gscCTRAnomalyMinClicksPrior,
		MinClicksLost:  gscCTRAnomalyMinClicksLost,
		Factory:        gscCTRAnomalyClientFactory,
		Stdout:         os.Stdout,
		Stderr:         os.Stderr,
		Now:            time.Now().UTC(),
	})
	os.Exit(status)
	return nil
}

type ctrAnomalyParams struct {
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

// ctrAnomalySparsePairsThreshold is the minimum number of (query, page)
// pairs that survive --min-clicks-prior below which the result set cannot
// be trusted. With fewer pairs than this, a "zero anomalies" result tells
// the Operator nothing — there's just not enough data to detect them.
const ctrAnomalySparsePairsThreshold = 5

func runCTRAnomalyCommand(p ctrAnomalyParams) int {
	if err := diagcmd.ValidateFormat(p.Format); err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	if err := validateCTRAnomalyDays(p.Days); err != nil {
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

	env, pairsCount, err := buildCTRAnomalyEnvelope(client, site, p.Days, p.MinClicksPrior, p.MinClicksLost, p.Now)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	if err := diagcmd.Render(p.Stdout, env, p.Format, ctrAnomalyColumns, ctrAnomalyTextRow); err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
	}

	// Sparse-data UX warning: when no anomalies came back AND the joined
	// sample is small, the Operator should know "0 anomalies" reflects
	// data scarcity rather than a clean run. Stderr-only so JSON
	// consumers never see it.
	if len(env.Results) == 0 && pairsCount < ctrAnomalySparsePairsThreshold {
		_, _ = fmt.Fprintf(p.Stderr,
			"warning: only %d (query, page) pairs cleared --min-clicks-prior=%d — too few to detect anomalies reliably. Try a longer window (e.g. --days 90) or lower --min-clicks-prior.\n",
			pairsCount, p.MinClicksPrior)
	}

	return diagcmd.ExitCode(nil, len(env.Results) > 0)
}

func validateCTRAnomalyDays(days int) error {
	if days < ctrAnomalyDaysMin || days > ctrAnomalyDaysMax {
		return fmt.Errorf("invalid --days %d: must be in [%d, %d]", days, ctrAnomalyDaysMin, ctrAnomalyDaysMax)
	}
	return nil
}

// ctrAnomalyWindows returns (currentStart, currentEnd, priorStart, priorEnd)
// as YYYY-MM-DD strings: the current window is the last `days` days ending
// at the most recent GSC-available day; the prior window is the `days`
// days immediately before it. now is parameterised for deterministic tests.
func ctrAnomalyWindows(now time.Time, days int) (string, string, string, string) {
	// GSC data lags ~1–3 days; mirror the BuildDateRange convention of
	// "yesterday is the most recent settled day".
	currentEnd := now.AddDate(0, 0, -1)
	currentStart := currentEnd.AddDate(0, 0, -(days - 1))
	priorEnd := currentStart.AddDate(0, 0, -1)
	priorStart := priorEnd.AddDate(0, 0, -(days - 1))
	fmt := "2006-01-02"
	return currentStart.Format(fmt), currentEnd.Format(fmt), priorStart.Format(fmt), priorEnd.Format(fmt)
}

func buildCTRAnomalyEnvelope(client gsc.SearchAPI, site string, days int, minClicksPrior, minClicksLost int64, now time.Time) (CTRAnomalyOutput, int, error) {
	curStart, curEnd, priorStart, priorEnd := ctrAnomalyWindows(now, days)

	currentReport, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  curStart,
		EndDate:    curEnd,
		Dimensions: []string{"query", "page"},
		RowLimit:   ctrAnomalyRowLimit,
		DataState:  "final",
	})
	if err != nil {
		return CTRAnomalyOutput{}, 0, fmt.Errorf("search analytics current window failed: %w", err)
	}

	priorReport, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  priorStart,
		EndDate:    priorEnd,
		Dimensions: []string{"query", "page"},
		RowLimit:   ctrAnomalyRowLimit,
		DataState:  "final",
	})
	if err != nil {
		return CTRAnomalyOutput{}, 0, fmt.Errorf("search analytics prior window failed: %w", err)
	}

	pairs := joinSearchAnalyticsRows(currentReport.Rows, priorReport.Rows, minClicksPrior)
	diag := diagnostics.CTRAnomaly(pairs)

	rows := make([]CTRAnomalyResultRow, 0, len(diag))
	for _, r := range diag {
		if r.ClicksLost < minClicksLost {
			continue
		}
		rows = append(rows, CTRAnomalyResultRow{
			Query:              r.Query,
			Page:               r.Page,
			PositionCurrent:    r.PositionCurrent,
			PositionPrior:      r.PositionPrior,
			PositionDelta:      r.PositionDelta,
			CTRCurrent:         r.CTRCurrent,
			CTRPrior:           r.CTRPrior,
			CTRDelta:           r.CTRDelta,
			ClicksCurrent:      r.ClicksCurrent,
			ClicksPrior:        r.ClicksPrior,
			ClicksLost:         r.ClicksLost,
			ImpressionsCurrent: r.ImpressionsCurrent,
			ImpressionsPrior:   r.ImpressionsPrior,
		})
	}

	return diagcmd.NewEnvelope(ctrAnomalyCommandName, site, now, rows, priorReport.QuotaUsed), len(pairs), nil
}

// joinSearchAnalyticsRows pairs current-window and prior-window rows by
// (query, page). Rows present in only one window are skipped — there is no
// pair to diff. The minClicksPrior floor is applied to the PRIOR window
// before pairing, because that's the baseline used for the CTR-delta ratio
// (and prior=0 noise should never produce an "anomaly").
func joinSearchAnalyticsRows(current, prior []gsc.SearchAnalyticsRow, minClicksPrior int64) []diagnostics.RowPair {
	currentByKey := make(map[string]gsc.SearchAnalyticsRow, len(current))
	for _, r := range current {
		if len(r.Keys) != 2 {
			continue
		}
		currentByKey[ctrAnomalyKey(r.Keys)] = r
	}

	pairs := make([]diagnostics.RowPair, 0, len(prior))
	for _, p := range prior {
		if len(p.Keys) != 2 {
			continue
		}
		if p.Clicks < minClicksPrior {
			continue
		}
		c, ok := currentByKey[ctrAnomalyKey(p.Keys)]
		if !ok {
			continue
		}
		pairs = append(pairs, diagnostics.RowPair{Current: c, Prior: p})
	}
	return pairs
}

func ctrAnomalyKey(keys []string) string {
	return keys[0] + "\x00" + keys[1]
}

var ctrAnomalyColumns = []string{
	"query", "page", "pos", "Δpos", "ctr_now", "ctr_prior", "Δctr", "clicks_lost",
}

func ctrAnomalyTextRow(r CTRAnomalyResultRow) []string {
	return []string{
		r.Query,
		r.Page,
		strconv.FormatFloat(r.PositionCurrent, 'f', 1, 64),
		strconv.FormatFloat(r.PositionDelta, 'f', 2, 64),
		formatCTRPercent(r.CTRCurrent),
		formatCTRPercent(r.CTRPrior),
		strconv.FormatFloat(r.CTRDelta*100, 'f', 1, 64) + "%",
		strconv.FormatInt(r.ClicksLost, 10),
	}
}
