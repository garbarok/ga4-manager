package cmd

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/garbarok/ga4-manager/internal/gsc/httpprobe"
)

const (
	hreflangDaysDefault      = 28
	hreflangDaysMin          = 1
	hreflangDaysMax          = 485
	hreflangMaxPagesDefault  = 50
	hreflangMinImprDefault   = 10
	hreflangPageRowLimit     = 5000
	hreflangQueryRowLimit    = 25000
	hreflangCommandName      = "gsc_hreflang"
	hreflangOverallTimeLimit = 3 * time.Minute
)

var (
	gscHreflangConfig         string
	gscHreflangFormat         string
	gscHreflangDays           int
	gscHreflangMaxPages       int
	gscHreflangMinImpressions int64
)

var gscHreflangCmd = &cobra.Command{
	Use:   "hreflang",
	Short: "Check hreflang translation pairs and cross-language ranking",
	Long: `Verify that translated pages are wired together with hreflang, and find
searches in one language answered by the page in another.

Pairs come from search_console.hreflang_pairs in the config. Without it,
pairs are discovered by fetching the --max-pages pages with the most search
impressions and reading their <link rel="alternate" hreflang> tags.

Checks (per pair):
  missing_return_link     a member does not list another member
  missing_self_reference  a page does not list itself
  wrong_target            an annotation points elsewhere, off-site, or at a
                          page that does not answer 200 (≤5 redirects)
  missing_x_default       no x-default entry (info)
  cross_language_ranking  a query in one pair language gets ≥ --min-impressions
                          on the other language's page

Fetches go only to the configured site's host, identify as
ga4-manager/<version>, run at most 4 at a time, and ignore robots.txt (these
are the Operator's own pages).

Exit codes:
  0  no warnings
  2  at least one warning
  1  command failed

Examples:
  ga4 gsc hreflang --config configs/mysite.yaml
  ga4 gsc hreflang --config configs/mysite.yaml --max-pages 20 --format json`,
	RunE: hreflangRunE,
}

func init() {
	gscCmd.AddCommand(gscHreflangCmd)
	gscHreflangCmd.Flags().StringVarP(&gscHreflangConfig, "config", "c", "", "Path to configuration file (required)")
	gscHreflangCmd.Flags().StringVar(&gscHreflangFormat, "format", diagcmd.FormatTable, "Output format: table or json")
	gscHreflangCmd.Flags().IntVar(&gscHreflangDays, "days", hreflangDaysDefault, "Lookback window in days (1–485)")
	gscHreflangCmd.Flags().IntVar(&gscHreflangMaxPages, "max-pages", hreflangMaxPagesDefault, "Pages to fetch for discovery when no hreflang_pairs are configured")
	gscHreflangCmd.Flags().Int64Var(&gscHreflangMinImpressions, "min-impressions", hreflangMinImprDefault, "Impressions a wrong-language query needs to be reported")
}

// pageFetcher is the probe surface the command uses; tests substitute it.
type pageFetcher interface {
	FetchAll(ctx context.Context, urls []string) map[string]httpprobe.Page
}

var gscHreflangClientFactory = func() (gsc.SearchAPI, func(), error) {
	client, err := gsc.NewClient()
	if err != nil {
		return nil, func() {}, err
	}
	return client, func() { _ = client.Close() }, nil
}

var gscHreflangFetcherFactory = func(allowHost func(string) bool) pageFetcher {
	return httpprobe.New("ga4-manager/"+Version, allowHost)
}

// HreflangResultRow is one row of the gsc_hreflang JSON results.
type HreflangResultRow struct {
	Pair         map[string]string `json:"pair,omitempty"`
	Page         string            `json:"page"`
	Issue        string            `json:"issue"`
	Severity     string            `json:"severity"`
	Detail       string            `json:"detail"`
	Query        string            `json:"query,omitempty"`
	ExpectedPage string            `json:"expected_page,omitempty"`
	Impressions  int64             `json:"impressions,omitempty"`
}

// HreflangOutput is the JSON envelope: the framework envelope plus the
// number of pages fetched over HTTP (quota_used counts API calls only).
type HreflangOutput struct {
	Command      string              `json:"command"`
	Site         string              `json:"site"`
	GeneratedAt  string              `json:"generated_at"`
	Results      []HreflangResultRow `json:"results"`
	PagesFetched int                 `json:"pages_fetched"`
	QuotaUsed    int                 `json:"quota_used"`
}

type hreflangParams struct {
	ConfigPath     string
	Format         string
	Days           int
	MaxPages       int
	MinImpressions int64
	Factory        func() (gsc.SearchAPI, func(), error)
	Fetcher        func(allowHost func(string) bool) pageFetcher
	Stdout         io.Writer
	Stderr         io.Writer
	Now            time.Time
}

func hreflangRunE(_ *cobra.Command, _ []string) error {
	os.Exit(runHreflangCommand(hreflangParams{
		ConfigPath:     gscHreflangConfig,
		Format:         gscHreflangFormat,
		Days:           gscHreflangDays,
		MaxPages:       gscHreflangMaxPages,
		MinImpressions: gscHreflangMinImpressions,
		Factory:        gscHreflangClientFactory,
		Fetcher:        gscHreflangFetcherFactory,
		Stdout:         os.Stdout,
		Stderr:         os.Stderr,
		Now:            time.Now().UTC(),
	}))
	return nil
}

func runHreflangCommand(p hreflangParams) int {
	if err := diagcmd.ValidateFormat(p.Format); err != nil {
		return diagcmd.FailWith(p.Stderr, "%v", err)
	}
	if p.Days < hreflangDaysMin || p.Days > hreflangDaysMax {
		return diagcmd.FailWith(p.Stderr, "invalid --days %d: must be in [%d, %d]", p.Days, hreflangDaysMin, hreflangDaysMax)
	}
	if p.MaxPages < 1 {
		return diagcmd.FailWith(p.Stderr, "invalid --max-pages %d: must be ≥ 1", p.MaxPages)
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

	ctx, cancel := context.WithTimeout(context.Background(), hreflangOverallTimeLimit)
	defer cancel()
	fetcher := p.Fetcher(cfg.SearchConsole.CoversHost)
	startDate, endDate := gsc.BuildDateRange(p.Days)
	quota := 0
	fetched := make(map[string]httpprobe.Page)

	pairs := cfg.SearchConsole.HreflangPairs
	if len(pairs) == 0 {
		report, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
			SiteURL: site, StartDate: startDate, EndDate: endDate,
			Dimensions: []string{"page"}, RowLimit: hreflangPageRowLimit, DataState: "final",
		})
		if err != nil {
			return diagcmd.FailWith(p.Stderr, "search analytics page query failed: %v", err)
		}
		quota = report.QuotaUsed
		for u, pg := range fetcher.FetchAll(ctx, topPages(report.Rows, p.MaxPages)) {
			fetched[u] = pg
		}
		pairs = diagnostics.DiscoverHreflangPairs(toHreflangPages(fetched))
	}

	var missing []string
	for _, pair := range pairs {
		for _, u := range pair {
			if _, ok := fetched[u]; !ok {
				missing = append(missing, u)
			}
		}
	}
	for u, pg := range fetcher.FetchAll(ctx, missing) {
		fetched[u] = pg
	}

	var queryRows []gsc.SearchAnalyticsRow
	if len(pairs) > 0 {
		report, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
			SiteURL: site, StartDate: startDate, EndDate: endDate,
			Dimensions: []string{"query", "page"}, RowLimit: hreflangQueryRowLimit, DataState: "final",
		})
		if err != nil {
			return diagcmd.FailWith(p.Stderr, "search analytics query×page query failed: %v", err)
		}
		queryRows = report.Rows
		quota = report.QuotaUsed // running total
	}

	pagesByURL := make(map[string]diagnostics.HreflangPage, len(fetched))
	for _, hp := range toHreflangPages(fetched) {
		pagesByURL[hp.URL] = hp
	}
	findings := diagnostics.Hreflang(diagnostics.HreflangInput{
		Pairs:          pairs,
		Pages:          pagesByURL,
		QueryRows:      queryRows,
		MinImpressions: p.MinImpressions,
	})

	rows := make([]HreflangResultRow, 0, len(findings))
	hasWarning := false
	for _, f := range findings {
		if f.Severity == diagnostics.SeverityWarning {
			hasWarning = true
		}
		rows = append(rows, HreflangResultRow{
			Pair: f.Pair, Page: f.Page, Issue: f.Issue, Severity: f.Severity, Detail: f.Detail,
			Query: f.Query, ExpectedPage: f.ExpectedPage, Impressions: f.Impressions,
		})
	}

	pagesFetched := 0
	for _, pg := range fetched {
		if pg.Requested {
			pagesFetched++
		}
	}

	if p.Format == diagcmd.FormatJSON {
		enc := json.NewEncoder(p.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(HreflangOutput{
			Command: hreflangCommandName, Site: site, GeneratedAt: p.Now.Format(time.RFC3339),
			Results: rows, PagesFetched: pagesFetched, QuotaUsed: quota,
		}); err != nil {
			return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
		}
	} else {
		env := diagcmd.NewEnvelope(hreflangCommandName, site, p.Now, rows, quota)
		if err := diagcmd.Render(p.Stdout, env, p.Format, hreflangColumns, hreflangTextRow); err != nil {
			return diagcmd.FailWith(p.Stderr, "failed to render output: %v", err)
		}
		_, _ = fmt.Fprintf(p.Stdout, "pages fetched: %d\n", pagesFetched)
	}
	return diagcmd.ExitCode(nil, hasWarning)
}

// topPages returns up to n page URLs by impressions desc.
func topPages(rows []gsc.SearchAnalyticsRow, n int) []string {
	sorted := append([]gsc.SearchAnalyticsRow(nil), rows...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Impressions > sorted[j].Impressions })
	var urls []string
	for _, r := range sorted {
		if len(urls) == n {
			break
		}
		if len(r.Keys) > 0 && r.Keys[0] != "" {
			urls = append(urls, r.Keys[0])
		}
	}
	return urls
}

func toHreflangPages(pages map[string]httpprobe.Page) []diagnostics.HreflangPage {
	keys := make([]string, 0, len(pages))
	for k := range pages {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]diagnostics.HreflangPage, 0, len(pages))
	for _, k := range keys {
		pg := pages[k]
		hp := diagnostics.HreflangPage{URL: k, FinalURL: pg.FinalURL, Status: pg.Status}
		for _, a := range pg.Alternates {
			hp.Alternates = append(hp.Alternates, diagnostics.HreflangAlt{Lang: a.Lang, Href: a.Href})
		}
		if pg.Err != nil {
			hp.FetchErr = pg.Err.Error()
			hp.OffHost = errors.Is(pg.Err, httpprobe.ErrOffHost)
		}
		out = append(out, hp)
	}
	return out
}

var hreflangColumns = []string{"page", "issue", "severity", "query", "impr", "detail"}

func hreflangTextRow(r HreflangResultRow) []string {
	impr := ""
	if r.Impressions > 0 {
		impr = strconv.FormatInt(r.Impressions, 10)
	}
	return []string{r.Page, r.Issue, r.Severity, r.Query, impr, r.Detail}
}
