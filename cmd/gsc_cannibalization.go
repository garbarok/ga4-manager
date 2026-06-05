package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagnostics"
)

const (
	cannibalizationDays          = 30
	cannibalizationRowLimit      = 5000
	cannibalizationDataState     = "final"
	cannibalizationCommandName   = "gsc_cannibalization"
	cannibalizationFormatText    = "text"
	cannibalizationFormatJSON    = "json"
	cannibalizationExitClean     = 0
	cannibalizationExitFailure   = 1
	cannibalizationExitIssues    = 2
	cannibalizationDimensionsCSV = "query,page"
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
	gscCannibalizationCmd.Flags().StringVar(&gscCannibalizationFormat, "format", cannibalizationFormatText, "Output format: text or json")
}

// gscClientFactory is the default factory that returns a live GSC client
// wrapped behind the SearchAPI interface. Tests substitute a fake here.
var gscClientFactory = func() (gsc.SearchAPI, func(), error) {
	client, err := gsc.NewClient()
	if err != nil {
		return nil, func() {}, err
	}
	return client, func() { _ = client.Close() }, nil
}

// CannibalizationPageOutput mirrors a qualifying page in the JSON output.
type CannibalizationPageOutput struct {
	Page        string `json:"page"`
	Impressions int64  `json:"impressions"`
}

// CannibalizationResultOutput is one row of the JSON results array.
type CannibalizationResultOutput struct {
	Query              string                      `json:"query"`
	Pages              []CannibalizationPageOutput `json:"pages"`
	TotalImpressions   int64                       `json:"total_impressions"`
	CanonicalCandidate string                      `json:"canonical_candidate"`
}

// CannibalizationOutput is the JSON envelope emitted under --format json and
// returned by the matching MCP tool. Field names follow the framework
// convention (see docs/BACKLOG.md "Implementation notes").
type CannibalizationOutput struct {
	Command     string                        `json:"command"`
	Site        string                        `json:"site"`
	GeneratedAt string                        `json:"generated_at"`
	Results     []CannibalizationResultOutput `json:"results"`
	QuotaUsed   int                           `json:"quota_used"`
}

// cannibalizationRunE is the cobra entry point. It delegates to
// runCannibalizationCommand, which is testable, then calls os.Exit with the
// status code the runner returned. Exit codes are 0 (clean), 2 (issues
// detected), or 1 (failure). Returning a cobra error would always map to
// exit 1, so the distinct exit-2 path requires an explicit os.Exit here.
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

// cannibalizationParams bundles every input runCannibalizationCommand depends
// on so the tests can drive it without touching globals or the process.
type cannibalizationParams struct {
	ConfigPath     string
	MinImpressions int64
	Format         string
	Factory        func() (gsc.SearchAPI, func(), error)
	Stdout         io.Writer
	Stderr         io.Writer
	Now            time.Time
}

// runCannibalizationCommand is the pure runner: it loads the config, applies
// the diagnostics predicate, renders output, and returns the framework exit
// code. Side effects are confined to the writers in params.
func runCannibalizationCommand(p cannibalizationParams) int {
	if p.ConfigPath == "" {
		writeLine(p.Stderr, "--config is required")
		return cannibalizationExitFailure
	}
	if p.Format != cannibalizationFormatText && p.Format != cannibalizationFormatJSON {
		writeLine(p.Stderr, fmt.Sprintf("invalid --format %q: must be text or json", p.Format))
		return cannibalizationExitFailure
	}

	cfg, err := config.LoadConfig(p.ConfigPath)
	if err != nil {
		writeLine(p.Stderr, fmt.Sprintf("failed to load config: %v", err))
		return cannibalizationExitFailure
	}
	if cfg.SearchConsole == nil || cfg.SearchConsole.SiteURL == "" {
		writeLine(p.Stderr, fmt.Sprintf("no search_console.site_url in %s", p.ConfigPath))
		return cannibalizationExitFailure
	}

	client, cleanup, err := p.Factory()
	if err != nil {
		writeLine(p.Stderr, fmt.Sprintf("failed to create GSC client: %v", err))
		return cannibalizationExitFailure
	}
	defer cleanup()

	output, err := executeCannibalization(client, cfg.SearchConsole.SiteURL, p.MinImpressions, p.Now)
	if err != nil {
		writeLine(p.Stderr, err.Error())
		return cannibalizationExitFailure
	}

	if err := renderCannibalization(p.Stdout, output, p.Format); err != nil {
		writeLine(p.Stderr, fmt.Sprintf("failed to render output: %v", err))
		return cannibalizationExitFailure
	}

	if len(output.Results) > 0 {
		return cannibalizationExitIssues
	}
	return cannibalizationExitClean
}

// writeLine writes msg followed by a newline, ignoring any I/O error. Used
// only for stderr diagnostics where there is no meaningful recovery path.
func writeLine(w io.Writer, msg string) {
	_, _ = w.Write([]byte(msg + "\n"))
}

// executeCannibalization performs the single API call, applies the predicate,
// and assembles the output envelope.
func executeCannibalization(client gsc.SearchAPI, site string, minImpressions int64, now time.Time) (CannibalizationOutput, error) {
	startDate, endDate := gsc.BuildDateRange(cannibalizationDays)
	query := &gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: strings.Split(cannibalizationDimensionsCSV, ","),
		RowLimit:   cannibalizationRowLimit,
		DataState:  cannibalizationDataState,
	}

	report, err := client.QuerySearchAnalytics(query)
	if err != nil {
		return CannibalizationOutput{}, fmt.Errorf("search analytics query failed: %w", err)
	}

	results := diagnostics.Cannibalisation(report.Rows, minImpressions)

	output := CannibalizationOutput{
		Command:     cannibalizationCommandName,
		Site:        site,
		GeneratedAt: now.Format(time.RFC3339),
		Results:     make([]CannibalizationResultOutput, 0, len(results)),
		QuotaUsed:   client.QuotaUsed(),
	}
	for _, r := range results {
		pages := make([]CannibalizationPageOutput, 0, len(r.Pages))
		for _, p := range r.Pages {
			pages = append(pages, CannibalizationPageOutput{Page: p.Page, Impressions: p.Impressions})
		}
		output.Results = append(output.Results, CannibalizationResultOutput{
			Query:              r.Query,
			Pages:              pages,
			TotalImpressions:   r.TotalImpressions,
			CanonicalCandidate: r.CanonicalCandidate,
		})
	}
	return output, nil
}

// renderCannibalization writes either the text table + footer or the JSON
// envelope. Text mode prints only the quota footer when no results,
// satisfying the framework's silent-on-all-green rule while still surfacing
// the quota cost.
func renderCannibalization(w io.Writer, output CannibalizationOutput, format string) error {
	if format == cannibalizationFormatJSON {
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		return enc.Encode(output)
	}

	if len(output.Results) == 0 {
		_, err := fmt.Fprintf(w, "quota used: %d\n", output.QuotaUsed)
		return err
	}

	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	if _, err := fmt.Fprintln(tw, "query\tpages\ttotal_impressions\tcanonical_candidate"); err != nil {
		return err
	}
	for _, r := range output.Results {
		if _, err := fmt.Fprintf(tw, "%s\t%d\t%d\t%s\n", r.Query, len(r.Pages), r.TotalImpressions, r.CanonicalCandidate); err != nil {
			return err
		}
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "quota used: %d\n", output.QuotaUsed); err != nil {
		return err
	}
	return nil
}
