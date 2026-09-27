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
	urlHygieneDaysDefault = 90
	urlHygieneDaysMin     = 1
	urlHygieneDaysMax     = 485
	urlHygieneRowLimit    = 25000
	urlHygieneCommandName = "gsc_url_hygiene"
)

var (
	gscURLHygieneConfig string
	gscURLHygieneFormat string
	gscURLHygieneDays   int
)

var gscURLHygieneCmd = &cobra.Command{
	Use:   "url-hygiene",
	Short: "Find URLs earning search impressions that should not be indexed",
	Long: `List URLs that receive Google search impressions but should never be
standalone search results. Each URL gets the first matching issue:

  malformed_path   path repeats the site's host or contains "//" (a broken
                   relative link somewhere on the site)
  fragment         URL contains "#" — an in-page anchor listed as a result
  asset_route      framework asset route: opengraph-image, twitter-image,
                   icon, apple-icon, or /_next/
  query_duplicate  URL with a query string whose clean twin is also indexed
  utility_page     privacy, terms, cookies, disclaimer, legal, contact (info)

Every finding carries a one-line fix. Stateless: one Search Analytics call.
The default window is 90 days — hygiene issues are low-volume and a 28-day
window tends to miss them.

Exit codes:
  0  no warnings (utility-page info findings may still be listed)
  2  at least one warning
  1  command failed

Examples:
  ga4 gsc url-hygiene --config configs/mysite.yaml
  ga4 gsc url-hygiene --config configs/mysite.yaml --format json --days 180`,
	RunE: urlHygieneRunE,
}

func init() {
	gscCmd.AddCommand(gscURLHygieneCmd)
	gscURLHygieneCmd.Flags().StringVarP(&gscURLHygieneConfig, "config", "c", "", "Path to configuration file (required)")
	gscURLHygieneCmd.Flags().StringVar(&gscURLHygieneFormat, "format", diagcmd.FormatTable, "Output format: table or json")
	gscURLHygieneCmd.Flags().IntVar(&gscURLHygieneDays, "days", urlHygieneDaysDefault, "Lookback window in days (1–485)")
}

// gscURLHygieneClientFactory returns a live GSC client. Tests substitute.
var gscURLHygieneClientFactory = func() (gsc.SearchAPI, func(), error) {
	client, err := gsc.NewClient()
	if err != nil {
		return nil, func() {}, err
	}
	return client, func() { _ = client.Close() }, nil
}

// URLHygieneResultRow is one row of the gsc_url_hygiene JSON results.
type URLHygieneResultRow struct {
	URL         string `json:"url"`
	Issue       string `json:"issue"`
	Severity    string `json:"severity"`
	Impressions int64  `json:"impressions"`
	Clicks      int64  `json:"clicks"`
	Fix         string `json:"fix"`
}

// URLHygieneOutput is the JSON envelope under --format json.
type URLHygieneOutput = diagcmd.Envelope[URLHygieneResultRow]

type urlHygieneParams struct {
	ConfigPath string
	Format     string
	Days       int
	Factory    func() (gsc.SearchAPI, func(), error)
	Stdout     io.Writer
	Stderr     io.Writer
	Now        time.Time
}

func urlHygieneRunE(_ *cobra.Command, _ []string) error {
	os.Exit(runURLHygieneCommand(urlHygieneParams{
		ConfigPath: gscURLHygieneConfig,
		Format:     gscURLHygieneFormat,
		Days:       gscURLHygieneDays,
		Factory:    gscURLHygieneClientFactory,
		Stdout:     os.Stdout,
		Stderr:     os.Stderr,
		Now:        time.Now().UTC(),
	}))
	return nil
}

func runURLHygieneCommand(p urlHygieneParams) int {
	if err := diagcmd.ValidateFormat(p.Format); err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	if p.Days < urlHygieneDaysMin || p.Days > urlHygieneDaysMax {
		return diagcmd.FailWith(p.Stderr, "invalid --days %d: must be in [%d, %d]", p.Days, urlHygieneDaysMin, urlHygieneDaysMax)
	}
	site, cfg, err := diagcmd.LoadSite(p.ConfigPath)
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}

	client, cleanup, err := p.Factory()
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to create GSC client: %v", err)
	}
	defer cleanup()

	startDate, endDate := gsc.BuildDateRange(p.Days)
	report, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  startDate,
		EndDate:    endDate,
		Dimensions: []string{"page"},
		RowLimit:   urlHygieneRowLimit,
		DataState:  "final",
	})
	if err != nil {
		return diagcmd.FailWith(p.Stderr, "search analytics query failed: %v", err)
	}

	findings := diagnostics.URLHygiene(report.Rows, []string{cfg.SearchConsole.SiteHost()})
	rows := make([]URLHygieneResultRow, 0, len(findings))
	hasWarning := false
	for _, f := range findings {
		if f.Severity == diagnostics.SeverityWarning {
			hasWarning = true
		}
		rows = append(rows, URLHygieneResultRow{
			URL:         f.URL,
			Issue:       f.Issue,
			Severity:    f.Severity,
			Impressions: f.Impressions,
			Clicks:      f.Clicks,
			Fix:         f.Fix,
		})
	}

	env := diagcmd.NewEnvelope(urlHygieneCommandName, site, p.Now, rows, report.QuotaUsed)
	if err := diagcmd.Render(p.Stdout, env, p.Format, urlHygieneColumns, urlHygieneTextRow); err != nil {
		return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
	}
	return diagcmd.ExitCode(nil, hasWarning)
}

var urlHygieneColumns = []string{"url", "issue", "severity", "impr", "clicks", "fix"}

func urlHygieneTextRow(r URLHygieneResultRow) []string {
	return []string{
		r.URL,
		r.Issue,
		r.Severity,
		strconv.FormatInt(r.Impressions, 10),
		strconv.FormatInt(r.Clicks, 10),
		r.Fix,
	}
}

// Compile-time check that the text renderer covers every column.
var _ = func() struct{} {
	if len(urlHygieneTextRow(URLHygieneResultRow{})) != len(urlHygieneColumns) {
		panic(fmt.Sprintf("url-hygiene: %d columns but row has %d cells", len(urlHygieneColumns), len(urlHygieneTextRow(URLHygieneResultRow{}))))
	}
	return struct{}{}
}()
