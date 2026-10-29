package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fatih/color"
	"github.com/spf13/cobra"

	"github.com/garbarok/ga4-manager/internal/audit"
	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
	"github.com/garbarok/ga4-manager/internal/render"
)

const (
	auditSourceBoth    = "both"
	auditSourceSitemap = "sitemap"
	auditSourceGSC     = "gsc"
)

var (
	gscAuditConfig      string
	gscAuditSite        string
	gscAuditSitemap     string
	gscAuditSource      string
	gscAuditDays        int
	gscAuditMinImpr     int64
	gscAuditLimit       int
	gscAuditUserAgent   string
	gscAuditTimeout     int
	gscAuditConcurrency int
	gscAuditFormat      string
)

var gscAuditCmd = &cobra.Command{
	Use:   "audit-urls",
	Short: "Probe indexed + sitemap URLs over HTTP for 404s, redirects and slash mismatches",
	Long: `Cross-reference the URLs Google actually knows about against what the site
serves live, and flag the problems the Search Console API alone cannot see.

It collects URLs from two sources (union, deduplicated):
  - gsc:     pages with search impressions (the URLs Google has indexed/ranks)
  - sitemap: every <loc> in the sitemap (index files are followed)

then issues a live HTTP request to each, following redirects manually, and
classifies the outcome:
  ok        terminal 2xx, no redirect
  redirect  reached 2xx via one or more redirects (chain + trailing-slash
            mismatches are surfaced as issues)
  broken    terminal status >= 400 (e.g. an indexed URL that now 404s)
  error     transport failure (DNS, TLS, timeout)

This is the check that catches a renamed/relocated page whose old URL is still
indexed but now 404s, or whose redirect source does not match the canonical
(trailing-slash) form Google has stored.

By default it identifies as Googlebot so CDNs that challenge unknown agents
still answer; override with --user-agent.

Exit codes:
  0  no broken/error URLs
  2  at least one broken or error URL
  1  command failed (config/sitemap/API error before probing)

Examples:
  ga4 gsc audit-urls --config configs/mysite.yaml
  ga4 gsc audit-urls --config configs/mysite.yaml --source gsc --days 90
  ga4 gsc audit-urls --site https://example.com/ --sitemap https://example.com/sitemap.xml
  ga4 gsc audit-urls --config configs/mysite.yaml --format json`,
	RunE: gscAuditRunE,
}

func init() {
	gscCmd.AddCommand(gscAuditCmd)
	gscAuditCmd.Flags().StringVarP(&gscAuditConfig, "config", "c", "", "Path to configuration file (provides site_url + sitemaps)")
	gscAuditCmd.Flags().StringVarP(&gscAuditSite, "site", "s", "", "Site URL (sc-domain:example.com or https://example.com/)")
	gscAuditCmd.Flags().StringVar(&gscAuditSitemap, "sitemap", "", "Sitemap URL (defaults to the first sitemap in config)")
	gscAuditCmd.Flags().StringVar(&gscAuditSource, "source", auditSourceBoth, "URL source: both, sitemap, or gsc")
	gscAuditCmd.Flags().IntVarP(&gscAuditDays, "days", "d", 90, "Lookback window for GSC pages (1-180)")
	gscAuditCmd.Flags().Int64Var(&gscAuditMinImpr, "min-impressions", 1, "Minimum impressions for a GSC page to be probed")
	gscAuditCmd.Flags().IntVarP(&gscAuditLimit, "limit", "l", 500, "Maximum URLs to probe (highest-impression first)")
	gscAuditCmd.Flags().StringVar(&gscAuditUserAgent, "user-agent", audit.DefaultUserAgent, "User-Agent for probes (defaults to Googlebot)")
	gscAuditCmd.Flags().IntVar(&gscAuditTimeout, "timeout", 15, "Per-request timeout in seconds")
	gscAuditCmd.Flags().IntVar(&gscAuditConcurrency, "concurrency", 8, "Number of concurrent probes")
	gscAuditCmd.Flags().StringVarP(&gscAuditFormat, "format", "f", "table", "Output format: table or json")
}

func gscAuditRunE(_ *cobra.Command, _ []string) error {
	os.Exit(runAuditCommand())
	return nil
}

type auditSource struct {
	sources     map[string]bool
	impressions int64
}

type auditSummary struct {
	Total    int `json:"total"`
	OK       int `json:"ok"`
	Redirect int `json:"redirect"`
	Blocked  int `json:"blocked"`
	Broken   int `json:"broken"`
	Error    int `json:"error"`
}

type auditOutput struct {
	Command     string           `json:"command"`
	Site        string           `json:"site"`
	GeneratedAt string           `json:"generated_at"`
	Summary     auditSummary     `json:"summary"`
	Results     []audit.URLAudit `json:"results"`
}

func runAuditCommand() int {
	if gscAuditFormat != "table" && gscAuditFormat != diagcmd.FormatJSON {
		return diagcmd.FailWith(os.Stderr, "invalid --format %q: must be table or json", gscAuditFormat)
	}
	switch gscAuditSource {
	case auditSourceBoth, auditSourceSitemap, auditSourceGSC:
	default:
		return diagcmd.FailWith(os.Stderr, "invalid --source %q: must be both, sitemap, or gsc", gscAuditSource)
	}
	if gscAuditDays < 1 || gscAuditDays > 180 {
		return diagcmd.FailWith(os.Stderr, "invalid --days %d: must be in [1, 180]", gscAuditDays)
	}

	site, sitemapURL, err := resolveAuditTargets()
	if err != nil {
		return diagcmd.FailWith(os.Stderr, "%v", err)
	}

	ctx := context.Background()
	prober := audit.NewProber(time.Duration(gscAuditTimeout)*time.Second, gscAuditUserAgent)

	// Collect the URL set (union of requested sources).
	collected := map[string]*auditSource{}
	wantGSC := gscAuditSource == auditSourceBoth || gscAuditSource == auditSourceGSC
	wantSitemap := gscAuditSource == auditSourceBoth || gscAuditSource == auditSourceSitemap

	if wantGSC {
		if err := collectGSCPages(site, collected); err != nil {
			return diagcmd.FailWith(os.Stderr, "%v", err)
		}
	}
	if wantSitemap {
		if sitemapURL == "" {
			if gscAuditSource == auditSourceSitemap {
				return diagcmd.FailWith(os.Stderr, "no sitemap URL: pass --sitemap or use a config with search_console.sitemaps")
			}
			fmt.Fprintln(os.Stderr, "⚠ No sitemap URL available (sc-domain property without --sitemap); skipping sitemap source")
		} else {
			urls, err := prober.FetchSitemapURLs(ctx, sitemapURL)
			if err != nil {
				if gscAuditSource == auditSourceSitemap {
					return diagcmd.FailWith(os.Stderr, "failed to fetch sitemap: %v", err)
				}
				fmt.Fprintf(os.Stderr, "⚠ Could not fetch sitemap (%v); continuing with GSC pages only\n", err)
			}
			for _, u := range urls {
				addAuditSource(collected, u, auditSourceSitemap, 0)
			}
		}
	}

	if len(collected) == 0 {
		return diagcmd.FailWith(os.Stderr, "no URLs collected to audit")
	}

	urls := sortedAuditURLs(collected, gscAuditLimit)

	// Progress goes to stderr so --format json keeps stdout pure JSON.
	fmt.Fprintf(os.Stderr, "🔎 Auditing %d URL(s) for %s...\n", len(urls), site)
	results := probeAll(ctx, prober, urls, collected, gscAuditConcurrency)
	sortAuditResults(results)

	out := auditOutput{
		Command:     "gsc_audit_urls",
		Site:        site,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Summary:     summarize(results),
		Results:     results,
	}

	if gscAuditFormat == diagcmd.FormatJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(out); err != nil {
			return diagcmd.FailWith(os.Stderr, "failed to encode JSON: %v", err)
		}
	} else {
		renderAuditTable(out)
	}

	if out.Summary.Broken > 0 || out.Summary.Error > 0 {
		return 2
	}
	return 0
}

// resolveAuditTargets returns the GSC site identifier and a fetchable sitemap
// URL from flags and/or config.
func resolveAuditTargets() (site, sitemapURL string, err error) {
	site = gscAuditSite
	sitemapURL = gscAuditSitemap

	if gscAuditConfig != "" {
		s, cfg, lerr := diagcmd.LoadSite(gscAuditConfig)
		if lerr != nil {
			return "", "", lerr
		}
		if site == "" {
			site = s
		}
		if sitemapURL == "" && cfg.SearchConsole != nil && len(cfg.SearchConsole.Sitemaps) > 0 {
			sitemapURL = cfg.SearchConsole.Sitemaps[0].URL
		}
	}

	if site == "" {
		return "", "", fmt.Errorf("a site is required: pass --site or --config")
	}
	// Derive a sitemap URL for URL-prefix properties when none was provided.
	if sitemapURL == "" && strings.HasPrefix(site, "http") {
		sitemapURL = strings.TrimSuffix(site, "/") + "/sitemap.xml"
	}
	return site, sitemapURL, nil
}

func collectGSCPages(site string, collected map[string]*auditSource) error {
	client, err := gsc.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create GSC client: %w", err)
	}
	defer func() { _ = client.Close() }()

	start, end := gsc.BuildDateRange(gscAuditDays)
	report, err := client.QuerySearchAnalytics(&gsc.SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  start,
		EndDate:    end,
		Dimensions: []string{"page"},
		RowLimit:   25000,
		DataState:  "final",
	})
	if err != nil {
		return fmt.Errorf("GSC page query failed: %w", err)
	}
	for _, row := range report.Rows {
		if len(row.Keys) == 0 || row.Impressions < gscAuditMinImpr {
			continue
		}
		addAuditSource(collected, row.Keys[0], auditSourceGSC, row.Impressions)
	}
	return nil
}

func addAuditSource(m map[string]*auditSource, rawURL, source string, impressions int64) {
	u := strings.TrimSpace(rawURL)
	if u == "" {
		return
	}
	e, ok := m[u]
	if !ok {
		e = &auditSource{sources: map[string]bool{}}
		m[u] = e
	}
	e.sources[source] = true
	if impressions > e.impressions {
		e.impressions = impressions
	}
}

// sortedAuditURLs returns up to limit URLs, highest-impression first so the
// most important pages are always probed when the cap is hit.
func sortedAuditURLs(m map[string]*auditSource, limit int) []string {
	urls := make([]string, 0, len(m))
	for u := range m {
		urls = append(urls, u)
	}
	sort.Slice(urls, func(i, j int) bool {
		ii, jj := m[urls[i]].impressions, m[urls[j]].impressions
		if ii != jj {
			return ii > jj
		}
		return urls[i] < urls[j]
	})
	if limit > 0 && len(urls) > limit {
		urls = urls[:limit]
	}
	return urls
}

func probeAll(ctx context.Context, prober *audit.Prober, urls []string, meta map[string]*auditSource, concurrency int) []audit.URLAudit {
	if concurrency < 1 {
		concurrency = 1
	}
	results := make([]audit.URLAudit, len(urls))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, u string) {
			defer wg.Done()
			defer func() { <-sem }()
			r := prober.Probe(ctx, u)
			if m := meta[u]; m != nil {
				r.Impressions = m.impressions
				r.Sources = sortedSources(m.sources)
			}
			results[i] = r
		}(i, u)
	}
	wg.Wait()
	return results
}

func sortedSources(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

// sortAuditResults orders worst-first (error, broken, redirect, ok) and then by
// impressions descending so the highest-impact problems lead the report.
func sortAuditResults(results []audit.URLAudit) {
	rank := map[string]int{audit.ClassError: 0, audit.ClassBroken: 1, audit.ClassBlocked: 2, audit.ClassRedirect: 3, audit.ClassOK: 4}
	sort.SliceStable(results, func(i, j int) bool {
		ri, rj := rank[results[i].Classification], rank[results[j].Classification]
		if ri != rj {
			return ri < rj
		}
		if results[i].Impressions != results[j].Impressions {
			return results[i].Impressions > results[j].Impressions
		}
		return results[i].URL < results[j].URL
	})
}

func summarize(results []audit.URLAudit) auditSummary {
	var s auditSummary
	s.Total = len(results)
	for _, r := range results {
		switch r.Classification {
		case audit.ClassOK:
			s.OK++
		case audit.ClassRedirect:
			s.Redirect++
		case audit.ClassBlocked:
			s.Blocked++
		case audit.ClassBroken:
			s.Broken++
		case audit.ClassError:
			s.Error++
		}
	}
	return s
}

func renderAuditTable(out auditOutput) {
	cols := []string{"status", "http", "impr", "sources", "url", "detail"}
	_ = render.Render(os.Stdout, render.FormatTable, cols, out.Results, auditTableRow)

	fmt.Println()
	color.Cyan("═══ Audit Summary ═══")
	fmt.Printf("Total: %d   ", out.Summary.Total)
	fmt.Printf("%s   ", color.GreenString("ok: %d", out.Summary.OK))
	fmt.Printf("%s   ", color.YellowString("redirect: %d", out.Summary.Redirect))
	fmt.Printf("%s   ", color.YellowString("blocked: %d", out.Summary.Blocked))
	fmt.Printf("%s   ", color.RedString("broken: %d", out.Summary.Broken))
	fmt.Printf("%s\n", color.RedString("error: %d", out.Summary.Error))
	if out.Summary.Broken == 0 && out.Summary.Error == 0 {
		color.Green("✓ No broken or errored URLs")
	} else {
		color.Red("✗ %d URL(s) need attention", out.Summary.Broken+out.Summary.Error)
	}
	if out.Summary.Blocked > 0 {
		color.Yellow("ℹ %d URL(s) returned 401/403/429 — likely CDN bot protection/rate-limiting; re-run with --concurrency 1 to confirm.", out.Summary.Blocked)
	}
}

func auditTableRow(r audit.URLAudit) []string {
	var statusCell string
	switch r.Classification {
	case audit.ClassOK:
		statusCell = color.GreenString("ok")
	case audit.ClassRedirect:
		statusCell = color.YellowString("redirect")
	case audit.ClassBlocked:
		statusCell = color.YellowString("blocked")
	case audit.ClassBroken:
		statusCell = color.RedString("broken")
	default:
		statusCell = color.RedString("error")
	}

	httpCell := strconv.Itoa(r.FinalStatus)
	if r.Classification == audit.ClassError {
		httpCell = "-"
	}

	impr := ""
	if r.Impressions > 0 {
		impr = strconv.FormatInt(r.Impressions, 10)
	}

	detail := ""
	if r.Error != "" {
		detail = r.Error
	} else if len(r.Issues) > 0 {
		detail = r.Issues[0]
	}

	url := r.URL
	if len(url) > 70 {
		url = url[:67] + "..."
	}
	if len(detail) > 60 {
		detail = detail[:57] + "..."
	}

	return []string{statusCell, httpCell, impr, strings.Join(r.Sources, "+"), url, detail}
}
