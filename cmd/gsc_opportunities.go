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
	opportunitiesDaysDefault = 28
	opportunitiesDaysMin     = 1
	opportunitiesDaysMax     = 485
	opportunitiesRowLimit    = 5000
	opportunitiesCommandName = "gsc_opportunities"
)

var (
	gscOpportunitiesConfig            string
	gscOpportunitiesFormat            string
	gscOpportunitiesDays              int
	gscOpportunitiesMinImpressions    int64
	gscOpportunitiesMinPotentialClick int64
)

var gscOpportunitiesCmd = &cobra.Command{
	Use:   "opportunities",
	Short: "Detect under-converting queries on page 1–2 of Search Console",
	Long: `Find Search Console queries where the page already ranks on page 1–2
(positions 5–20) but the click-through rate is below the median for its
position bucket. These are titles/meta descriptions that just need to be
re-written: the rankings already exist, only the snippet is failing to
convert.

Results are ranked by PotentialClicks descending — the absolute number of
extra monthly clicks the page would receive if it converted at the median
CTR for its rank — so an Operator (or LLM consumer) acts on the biggest
revenue win first.

Each result carries everything a title-rewrite agent needs:
  query, page, position, clicks, impressions, ctr, bucket,
  category_median_ctr, ctr_gap, potential_clicks
The current page title/meta are NOT in GSC data — fetch them from the
site itself if you want to feed them to an LLM for rewriting.

Filter knobs:
  --min-impressions N      ignore queries below this monthly impression
                           threshold (default 20 — low-impression queries
                           are noise)
  --min-potential-clicks N ignore opportunities below this projected
                           click gain (default 0 — show everything)

Stateless: one Search Analytics API call per run. No state files written.

Exit codes:
  0  no opportunities detected
  2  at least one opportunity detected
  1  command failed (API error, malformed config, etc.)

Examples:
  ga4 gsc opportunities --config configs/mysite.yaml
  ga4 gsc opportunities --config configs/mysite.yaml --format json
  ga4 gsc opportunities --config configs/mysite.yaml --min-impressions 50
  ga4 gsc opportunities --config configs/mysite.yaml --min-potential-clicks 10`,
	RunE: opportunitiesRunE,
}

func init() {
	gscCmd.AddCommand(gscOpportunitiesCmd)
	gscOpportunitiesCmd.Flags().StringVarP(&gscOpportunitiesConfig, "config", "c", "", "Path to configuration file (required)")
	gscOpportunitiesCmd.Flags().StringVar(&gscOpportunitiesFormat, "format", diagcmd.FormatTable, "Output format: table or json")
	gscOpportunitiesCmd.Flags().IntVar(&gscOpportunitiesDays, "days", opportunitiesDaysDefault, "Lookback window in days (1–485)")
	gscOpportunitiesCmd.Flags().Int64Var(&gscOpportunitiesMinImpressions, "min-impressions", 5, "Minimum impressions for a query to be considered (drops noise; default 5 — small sites need a low floor)")
	gscOpportunitiesCmd.Flags().Int64Var(&gscOpportunitiesMinPotentialClick, "min-potential-clicks", 1, "Drop opportunities below this projected click gain (default 1 — suppresses 0-click rounding-error findings)")
}

// gscOpportunitiesClientFactory returns a live GSC client. Tests substitute.
var gscOpportunitiesClientFactory = func() (gsc.SearchAPI, func(), error) {
	client, err := gsc.NewClient()
	if err != nil {
		return nil, func() {}, err
	}
	return client, func() { _ = client.Close() }, nil
}

// OpportunityResultRow is one row of the gsc_opportunities JSON results.
type OpportunityResultRow struct {
	Query             string  `json:"query"`
	Page              string  `json:"page"`
	Position          float64 `json:"position"`
	Clicks            int64   `json:"clicks"`
	Impressions       int64   `json:"impressions"`
	CTR               float64 `json:"ctr"`
	Bucket            int     `json:"bucket"`
	CategoryMedianCTR float64 `json:"category_median_ctr"`
	// MedianSource is "site" when ≥2 same-site rows in the bucket produced
	// the median, "baseline" when the published industry curve was used as
	// fallback. Small sites mostly see "baseline" — that's expected.
	MedianSource    string  `json:"median_source"`
	CTRGap          float64 `json:"ctr_gap"`
	PotentialClicks int64   `json:"potential_clicks"`
}

// OpportunitiesOutput is the JSON envelope under --format json.
type OpportunitiesOutput = diagcmd.Envelope[OpportunityResultRow]

func opportunitiesRunE(_ *cobra.Command, _ []string) error {
	status := runOpportunitiesCommand(opportunitiesParams{
		ConfigPath:         gscOpportunitiesConfig,
		Format:             gscOpportunitiesFormat,
		Days:               gscOpportunitiesDays,
		MinImpressions:     gscOpportunitiesMinImpressions,
		MinPotentialClicks: gscOpportunitiesMinPotentialClick,
		Factory:            gscOpportunitiesClientFactory,
		Stdout:             os.Stdout,
		Stderr:             os.Stderr,
		Now:                time.Now().UTC(),
	})
	os.Exit(status)
	return nil
}

type opportunitiesParams struct {
	ConfigPath         string
	Format             string
	Days               int
	MinImpressions     int64
	MinPotentialClicks int64
	Factory            func() (gsc.SearchAPI, func(), error)
	Stdout             io.Writer
	Stderr             io.Writer
	Now                time.Time
}

func runOpportunitiesCommand(p opportunitiesParams) int {
	if err := diagcmd.ValidateFormat(p.Format); err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	if err := validateOpportunitiesDays(p.Days); err != nil {
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

	env, err := buildOpportunitiesEnvelope(client, site, p.Days, p.MinImpressions, p.MinPotentialClicks, p.Now)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	if err := diagcmd.Render(p.Stdout, env, p.Format, opportunitiesColumns, opportunitiesTextRow); err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
	}

	return diagcmd.ExitCode(nil, len(env.Results) > 0)
}

func validateOpportunitiesDays(days int) error {
	if days < opportunitiesDaysMin || days > opportunitiesDaysMax {
		return fmt.Errorf("invalid --days %d: must be in [%d, %d]", days, opportunitiesDaysMin, opportunitiesDaysMax)
	}
	return nil
}

func buildOpportunitiesEnvelope(client gsc.SearchAPI, site string, days int, minImpressions, minPotentialClicks int64, now time.Time) (OpportunitiesOutput, error) {
	startDate, endDate := gsc.BuildDateRange(days)
	report, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"query", "page"},
		RowLimit:   opportunitiesRowLimit,
		DataState:  "final",
	})
	if err != nil {
		return OpportunitiesOutput{}, fmt.Errorf("search analytics query failed: %w", err)
	}

	// Drop rows below the impression noise threshold BEFORE running the
	// predicate, so the position-bucket medians are not dragged down by
	// long-tail single-impression queries.
	filtered := make([]gsc.SearchAnalyticsRow, 0, len(report.Rows))
	for _, r := range report.Rows {
		if r.Impressions >= minImpressions {
			filtered = append(filtered, r)
		}
	}

	diag := diagnostics.Opportunity(filtered)
	rows := make([]OpportunityResultRow, 0, len(diag))
	for _, r := range diag {
		if r.PotentialClicks < minPotentialClicks {
			continue
		}
		rows = append(rows, OpportunityResultRow{
			Query:             r.Query,
			Page:              r.Page,
			Position:          r.Position,
			Clicks:            r.Clicks,
			Impressions:       r.Impressions,
			CTR:               r.CTR,
			Bucket:            r.Bucket,
			CategoryMedianCTR: r.CategoryMedianCTR,
			MedianSource:      r.MedianSource,
			CTRGap:            r.CTRGap,
			PotentialClicks:   r.PotentialClicks,
		})
	}

	return diagcmd.NewEnvelope(opportunitiesCommandName, site, now, rows, report.QuotaUsed), nil
}

var opportunitiesColumns = []string{
	"query", "page", "pos", "impr", "ctr", "median_ctr", "src", "gap", "potential_clicks",
}

func opportunitiesTextRow(r OpportunityResultRow) []string {
	return []string{
		r.Query,
		r.Page,
		strconv.FormatFloat(r.Position, 'f', 1, 64),
		strconv.FormatInt(r.Impressions, 10),
		formatCTRPercent(r.CTR),
		formatCTRPercent(r.CategoryMedianCTR),
		r.MedianSource,
		formatCTRPercent(r.CTRGap),
		strconv.FormatInt(r.PotentialClicks, 10),
	}
}

func formatCTRPercent(v float64) string {
	return strconv.FormatFloat(v*100, 'f', 2, 64) + "%"
}
