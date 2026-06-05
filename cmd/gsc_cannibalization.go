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
	cannibalizationDays        = 30
	cannibalizationRowLimit    = 5000
	cannibalizationCommandName = "gsc_cannibalization"
)

var (
	gscCannibalizationConfig         string
	gscCannibalizationMinImpressions int64
	gscCannibalizationFormat         string
)

var gscCannibalizationCmd = &cobra.Command{
	Use:   "cannibalization",
	Short: "Detect query cannibalisation across pages",
	Long: `Detect Search Console queries where two or more pages on the same site
each receive at least --min-impressions impressions, splitting authority and
indicating duplicate-ranking content to consolidate.

Stateless: one Search Analytics API call per run. No state files written.

Exit codes:
  0  no cannibalising queries detected
  2  at least one cannibalising query detected
  1  command failed (API error, malformed config, etc.)

Examples:
  ga4 gsc cannibalization --config configs/mysite.yaml
  ga4 gsc cannibalization --config configs/mysite.yaml --format json
  ga4 gsc cannibalization --config configs/mysite.yaml --min-impressions 25`,
	RunE: cannibalizationRunE,
}

func init() {
	gscCmd.AddCommand(gscCannibalizationCmd)

	gscCannibalizationCmd.Flags().StringVarP(&gscCannibalizationConfig, "config", "c", "", "Path to configuration file (required)")
	gscCannibalizationCmd.Flags().Int64Var(&gscCannibalizationMinImpressions, "min-impressions", diagnostics.DefaultMinImpressions, "Per-page impression threshold for the cannibalisation predicate")
	gscCannibalizationCmd.Flags().StringVar(&gscCannibalizationFormat, "format", diagcmd.FormatText, "Output format: text or json")
}

// gscClientFactory returns a live GSC client wrapped behind the SearchAPI
// interface. Tests substitute a fake.
var gscClientFactory = func() (gsc.SearchAPI, func(), error) {
	client, err := gsc.NewClient()
	if err != nil {
		return nil, func() {}, err
	}
	return client, func() { _ = client.Close() }, nil
}

// CannibalizationPage mirrors one qualifying page in the JSON envelope.
type CannibalizationPage struct {
	Page        string `json:"page"`
	Impressions int64  `json:"impressions"`
}

// CannibalizationResultRow is one row of the JSON results array.
type CannibalizationResultRow struct {
	Query              string                `json:"query"`
	Pages              []CannibalizationPage `json:"pages"`
	TotalImpressions   int64                 `json:"total_impressions"`
	CanonicalCandidate string                `json:"canonical_candidate"`
}

// CannibalizationOutput is the JSON envelope emitted under --format json.
type CannibalizationOutput = diagcmd.Envelope[CannibalizationResultRow]

func cannibalizationRunE(_ *cobra.Command, _ []string) error {
	status := runCannibalizationCommand(cannibalizationParams{
		ConfigPath:     gscCannibalizationConfig,
		MinImpressions: gscCannibalizationMinImpressions,
		Format:         gscCannibalizationFormat,
		Factory:        gscClientFactory,
		Stdout:         os.Stdout,
		Stderr:         os.Stderr,
		Now:            time.Now().UTC(),
	})
	os.Exit(status)
	return nil
}

type cannibalizationParams struct {
	ConfigPath     string
	MinImpressions int64
	Format         string
	Factory        func() (gsc.SearchAPI, func(), error)
	Stdout         io.Writer
	Stderr         io.Writer
	Now            time.Time
}

func runCannibalizationCommand(p cannibalizationParams) int {
	if err := diagcmd.ValidateFormat(p.Format); err != nil {
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

	env, err := buildCannibalizationEnvelope(client, site, p.MinImpressions, p.Now)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	if err := diagcmd.Render(p.Stdout, env, p.Format, cannibalizationColumns, cannibalizationTextRow); err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
	}

	return diagcmd.ExitCode(nil, len(env.Results) > 0)
}

func buildCannibalizationEnvelope(client gsc.SearchAPI, site string, minImpressions int64, now time.Time) (CannibalizationOutput, error) {
	startDate, endDate := gsc.BuildDateRange(cannibalizationDays)
	report, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"query", "page"},
		RowLimit:   cannibalizationRowLimit,
		DataState:  "final",
	})
	if err != nil {
		return CannibalizationOutput{}, fmt.Errorf("search analytics query failed: %w", err)
	}

	diag := diagnostics.Cannibalisation(report.Rows, minImpressions)
	rows := make([]CannibalizationResultRow, 0, len(diag))
	for _, r := range diag {
		pages := make([]CannibalizationPage, 0, len(r.Pages))
		for _, p := range r.Pages {
			pages = append(pages, CannibalizationPage{Page: p.Page, Impressions: p.Impressions})
		}
		rows = append(rows, CannibalizationResultRow{
			Query:              r.Query,
			Pages:              pages,
			TotalImpressions:   r.TotalImpressions,
			CanonicalCandidate: r.CanonicalCandidate,
		})
	}

	return diagcmd.NewEnvelope(cannibalizationCommandName, site, now, rows, report.QuotaUsed), nil
}

var cannibalizationColumns = []string{"query", "pages", "total_impressions", "canonical_candidate"}

func cannibalizationTextRow(r CannibalizationResultRow) []string {
	return []string{
		r.Query,
		strconv.Itoa(len(r.Pages)),
		strconv.FormatInt(r.TotalImpressions, 10),
		r.CanonicalCandidate,
	}
}
