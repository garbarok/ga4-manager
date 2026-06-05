package cmd

import (
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
	"github.com/garbarok/ga4-manager/internal/gsc/diagnostics"
)

const (
	cannibalizationDaysDefault = 28
	cannibalizationDaysMin     = 1
	cannibalizationDaysMax     = 485 // GSC retains roughly 16 months of search-analytics data
	cannibalizationRowLimit    = 5000
	cannibalizationCommandName = "gsc_cannibalization"

	// CoverageStatePageWithRedirect is the URL Inspection coverage_state
	// string GSC returns for a page that is being redirected away. A
	// cannibalisation pair where either side is in this state is
	// "consolidating" rather than "actionable" — the impressions are still
	// being attributed under GSC's 28-day window but the migration is
	// already in flight.
	CoverageStatePageWithRedirect = "Page with redirect"

	// SeverityActionable indicates every page in the result is in a
	// non-redirect coverage state — the Operator can act on this pair
	// today.
	SeverityActionable = "actionable"

	// SeverityConsolidating indicates at least one page in the result is
	// a "Page with redirect" — the migration is mid-flight and the finding
	// will decay out of the GSC attribution window on its own.
	SeverityConsolidating = "consolidating"
)

var (
	gscCannibalizationConfig            string
	gscCannibalizationMinImpressions    int64
	gscCannibalizationFormat            string
	gscCannibalizationDays              int
	gscCannibalizationWithCoverageState bool
)

var gscCannibalizationCmd = &cobra.Command{
	Use:   "cannibalization",
	Short: "Detect query cannibalisation across pages",
	Long: `Detect Search Console queries where two or more pages on the same site
each receive at least --min-impressions impressions, splitting authority and
indicating duplicate-ranking content to consolidate.

Stateless: one Search Analytics API call per run. No state files written.

The canonical_candidate field is a heuristic: it is the page with the most
impressions on the query, NOT Google's chosen canonical. For migrating
sites GSC may still attribute impressions to the legacy URL under its
28-day window, so the impression leader can be the page you intend to
redirect AWAY from. Use --with-coverage-state to surface the underlying
coverage_state on each page and let the severity tier guide you.

Pass --with-coverage-state to additionally inspect each unique candidate
page via the URL Inspection API. Each result then carries a severity:
  actionable     — every page is in a non-redirect coverage state
  consolidating  — at least one page is "Page with redirect"; the
                   migration is mid-flight and the finding will decay
                   out of the GSC attribution window on its own.
Quota cost: one URL Inspection request per unique candidate page; off
by default because URL Inspection has a 2000/day budget.

Exit codes:
  0  no cannibalising queries detected
  2  at least one cannibalising query detected
  1  command failed (API error, malformed config, etc.)

Examples:
  ga4 gsc cannibalization --config configs/mysite.yaml
  ga4 gsc cannibalization --config configs/mysite.yaml --format json
  ga4 gsc cannibalization --config configs/mysite.yaml --min-impressions 25
  ga4 gsc cannibalization --config configs/mysite.yaml --days 90
  ga4 gsc cannibalization --config configs/mysite.yaml --with-coverage-state`,
	RunE: cannibalizationRunE,
}

func init() {
	gscCmd.AddCommand(gscCannibalizationCmd)

	gscCannibalizationCmd.Flags().StringVarP(&gscCannibalizationConfig, "config", "c", "", "Path to configuration file (required)")
	gscCannibalizationCmd.Flags().Int64Var(&gscCannibalizationMinImpressions, "min-impressions", diagnostics.DefaultMinImpressions, "Per-page impression threshold for the cannibalisation predicate")
	gscCannibalizationCmd.Flags().StringVar(&gscCannibalizationFormat, "format", diagcmd.FormatTable, "Output format: table or json")
	gscCannibalizationCmd.Flags().IntVar(&gscCannibalizationDays, "days", cannibalizationDaysDefault, "Lookback window in days (1–485)")
	gscCannibalizationCmd.Flags().BoolVar(&gscCannibalizationWithCoverageState, "with-coverage-state", false, "Inspect each candidate page via URL Inspection and emit a severity tier per finding")
}

// cannibalizationClient is the union of GSC capabilities this command can
// use. The InspectAPI half is exercised only when --with-coverage-state is
// set; without the flag the command never calls InspectURL.
type cannibalizationClient interface {
	gsc.SearchAPI
	gsc.InspectAPI
}

// gscClientFactory returns a live GSC client. Tests substitute a fake.
var gscClientFactory = func() (cannibalizationClient, func(), error) {
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
	// CoverageState is populated only when --with-coverage-state is set;
	// otherwise the field is omitted from JSON output.
	CoverageState string `json:"coverage_state,omitempty"`
}

// CannibalizationResultRow is one row of the JSON results array.
type CannibalizationResultRow struct {
	Query              string                `json:"query"`
	Pages              []CannibalizationPage `json:"pages"`
	TotalImpressions   int64                 `json:"total_impressions"`
	CanonicalCandidate string                `json:"canonical_candidate"`
	// Severity is populated only when --with-coverage-state is set;
	// otherwise the field is omitted from JSON output.
	Severity string `json:"severity,omitempty"`
}

// CannibalizationOutput is the JSON envelope emitted under --format json.
type CannibalizationOutput = diagcmd.Envelope[CannibalizationResultRow]

func cannibalizationRunE(_ *cobra.Command, _ []string) error {
	status := runCannibalizationCommand(cannibalizationParams{
		ConfigPath:         gscCannibalizationConfig,
		MinImpressions:     gscCannibalizationMinImpressions,
		Format:             gscCannibalizationFormat,
		Days:               gscCannibalizationDays,
		WithCoverageState:  gscCannibalizationWithCoverageState,
		Factory:            gscClientFactory,
		Stdout:             os.Stdout,
		Stderr:             os.Stderr,
		Now:                time.Now().UTC(),
	})
	os.Exit(status)
	return nil
}

type cannibalizationParams struct {
	ConfigPath        string
	MinImpressions    int64
	Format            string
	Days              int
	WithCoverageState bool
	Factory           func() (cannibalizationClient, func(), error)
	Stdout            io.Writer
	Stderr            io.Writer
	Now               time.Time
}

func runCannibalizationCommand(p cannibalizationParams) int {
	if err := diagcmd.ValidateFormat(p.Format); err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	if err := validateCannibalizationDays(p.Days); err != nil {
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

	env, err := buildCannibalizationEnvelope(client, site, p.MinImpressions, p.Days, p.WithCoverageState, p.Now)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	if err := diagcmd.Render(p.Stdout, env, p.Format, cannibalizationColumnsFor(p.WithCoverageState), cannibalizationTextRowFor(p.WithCoverageState)); err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
	}

	return diagcmd.ExitCode(nil, len(env.Results) > 0)
}

func validateCannibalizationDays(days int) error {
	if days < cannibalizationDaysMin || days > cannibalizationDaysMax {
		return fmt.Errorf("invalid --days %d: must be in [%d, %d]", days, cannibalizationDaysMin, cannibalizationDaysMax)
	}
	return nil
}

func buildCannibalizationEnvelope(client cannibalizationClient, site string, minImpressions int64, days int, withCoverageState bool, now time.Time) (CannibalizationOutput, error) {
	startDate, endDate := gsc.BuildDateRange(days)
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

	quota := report.QuotaUsed
	if withCoverageState {
		inspections, err := annotateWithCoverageState(client, site, rows)
		if err != nil {
			return CannibalizationOutput{}, fmt.Errorf("coverage-state inspection failed: %w", err)
		}
		quota = report.QuotaUsed + inspections
	}

	return diagcmd.NewEnvelope(cannibalizationCommandName, site, now, rows, quota), nil
}

// annotateWithCoverageState inspects each unique candidate page once and
// fills in CoverageState on every page entry plus a Severity tier on every
// result. Returns the number of URL Inspection calls made so the caller can
// add it to the quota footer.
func annotateWithCoverageState(client gsc.InspectAPI, site string, rows []CannibalizationResultRow) (int, error) {
	uniquePages := make(map[string]struct{})
	for _, r := range rows {
		for _, p := range r.Pages {
			uniquePages[p.Page] = struct{}{}
		}
	}

	pageList := make([]string, 0, len(uniquePages))
	for p := range uniquePages {
		pageList = append(pageList, p)
	}
	sort.Strings(pageList) // deterministic call order for tests + logs

	state := make(map[string]string, len(pageList))
	for _, page := range pageList {
		result, err := client.InspectURL(site, page)
		if err != nil {
			return 0, fmt.Errorf("inspect %s: %w", page, err)
		}
		state[page] = result.CoverageState
	}

	for i := range rows {
		hasRedirect := false
		for j := range rows[i].Pages {
			cov := state[rows[i].Pages[j].Page]
			rows[i].Pages[j].CoverageState = cov
			if cov == CoverageStatePageWithRedirect {
				hasRedirect = true
			}
		}
		if hasRedirect {
			rows[i].Severity = SeverityConsolidating
		} else {
			rows[i].Severity = SeverityActionable
		}
	}

	return len(pageList), nil
}

func cannibalizationColumnsFor(withCoverageState bool) []string {
	cols := []string{"query", "pages", "total_impressions", "canonical_candidate"}
	if withCoverageState {
		cols = append(cols, "severity")
	}
	return cols
}

func cannibalizationTextRowFor(withCoverageState bool) func(CannibalizationResultRow) []string {
	return func(r CannibalizationResultRow) []string {
		cells := []string{
			r.Query,
			strconv.Itoa(len(r.Pages)),
			strconv.FormatInt(r.TotalImpressions, 10),
			r.CanonicalCandidate,
		}
		if withCoverageState {
			cells = append(cells, r.Severity)
		}
		return cells
	}
}
