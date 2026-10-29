package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/garbarok/ga4-manager/internal/gsc"
	"github.com/garbarok/ga4-manager/internal/gsc/diagcmd"
	"github.com/garbarok/ga4-manager/internal/gsc/httpprobe"
)

const (
	hlEN = "https://www.x.app/calculator/mortgage-calculator"
	hlES = "https://www.x.app/calculator/calculadora-hipoteca"
)

// fakeFetcher serves canned pages and records requests; it honours the
// host allow-list like the real prober.
type fakeFetcher struct {
	allow     func(string) bool
	pages     map[string]httpprobe.Page
	requested []string
}

func (f *fakeFetcher) FetchAll(_ context.Context, urls []string) map[string]httpprobe.Page {
	out := make(map[string]httpprobe.Page)
	for _, u := range urls {
		parsed, _ := url.Parse(u)
		if !f.allow(parsed.Hostname()) {
			out[u] = httpprobe.Page{URL: u, Err: fmt.Errorf("%w: %s", httpprobe.ErrOffHost, u)}
			continue
		}
		f.requested = append(f.requested, u)
		pg, ok := f.pages[u]
		if !ok {
			pg = httpprobe.Page{URL: u, FinalURL: u, Status: 200}
		}
		pg.Requested = true
		out[u] = pg
	}
	return out
}

func alt(lang, href string) httpprobe.Alternate { return httpprobe.Alternate{Lang: lang, Href: href} }

func writeHreflangConfig(t *testing.T, pairs string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	body := "project:\n  name: x\nsearch_console:\n  site_url: sc-domain:x.app\n" + pairs
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func runHreflang(t *testing.T, configPath string, gscRows map[string][]gsc.SearchAnalyticsRow, pages map[string]httpprobe.Page) (int, HreflangOutput, *fakeFetcher, *fakeDimensionClient) {
	t.Helper()
	client := &fakeDimensionClient{byDims: gscRows}
	var fetcher *fakeFetcher
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}
	status := runHreflangCommand(hreflangParams{
		ConfigPath:     configPath,
		Format:         diagcmd.FormatJSON,
		Days:           28,
		MaxPages:       hreflangMaxPagesDefault,
		MinImpressions: 10,
		Factory:        func() (gsc.SearchAPI, func(), error) { return client, func() {}, nil },
		Fetcher: func(allow func(string) bool) pageFetcher {
			fetcher = &fakeFetcher{allow: allow, pages: pages}
			return fetcher
		},
		Stdout: stdout,
		Stderr: stderr,
		Now:    time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC),
	})
	var out HreflangOutput
	if status != diagcmd.ExitFailure {
		if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
			t.Fatalf("invalid JSON: %v\n%s", err, stdout.String())
		}
	} else {
		t.Fatalf("command failed: %s", stderr.String())
	}
	return status, out, fetcher, client
}

func TestHreflangCommand_ConfigPairsNoDiscovery(t *testing.T) {
	cfg := writeHreflangConfig(t, fmt.Sprintf("  hreflang_pairs:\n    - en: %q\n      es: %q\n", hlEN, hlES))
	pages := map[string]httpprobe.Page{
		hlEN: {URL: hlEN, FinalURL: hlEN, Status: 200, Alternates: []httpprobe.Alternate{alt("en", hlEN), alt("es", hlES), alt("x-default", hlEN)}},
		hlES: {URL: hlES, FinalURL: hlES, Status: 200, Alternates: []httpprobe.Alternate{alt("es", hlES)}},
	}
	rows := map[string][]gsc.SearchAnalyticsRow{
		"query,page": {{Keys: []string{"how much house can i afford calculator", hlES}, Impressions: 25}},
	}
	status, out, fetcher, client := runHreflang(t, cfg, rows, pages)

	if status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want %d", status, diagcmd.ExitIssues)
	}
	if len(fetcher.requested) != 2 || out.PagesFetched != 2 {
		t.Errorf("fetched %v (pages_fetched %d), want exactly the two pair members", fetcher.requested, out.PagesFetched)
	}
	if len(client.queries) != 1 || client.queries[0].Dimensions[0] != "query" {
		t.Errorf("config pairs must skip the discovery page query; calls = %d", len(client.queries))
	}
	if out.QuotaUsed != 1 {
		t.Errorf("quota_used = %d, want 1", out.QuotaUsed)
	}
	issues := map[string]bool{}
	for _, r := range out.Results {
		issues[r.Issue+"@"+r.Page] = true
	}
	if !issues["missing_return_link@"+hlES] || !issues["cross_language_ranking@"+hlES] {
		t.Errorf("results = %+v", out.Results)
	}
}

func TestHreflangCommand_DiscoveryFetchesTopPagesThenMembers(t *testing.T) {
	cfg := writeHreflangConfig(t, "")
	pages := map[string]httpprobe.Page{
		hlEN: {URL: hlEN, FinalURL: hlEN, Status: 200, Alternates: []httpprobe.Alternate{alt("en", hlEN), alt("es", hlES), alt("x-default", hlEN)}},
		hlES: {URL: hlES, FinalURL: hlES, Status: 200, Alternates: []httpprobe.Alternate{alt("en", hlEN), alt("es", hlES)}},
	}
	rows := map[string][]gsc.SearchAnalyticsRow{
		"page": {
			{Keys: []string{hlEN}, Impressions: 100000},
			{Keys: []string{"https://www.x.app/"}, Impressions: 2000},
			{Keys: []string{hlES}, Impressions: 50000},
		},
	}
	status, out, fetcher, client := runHreflang(t, cfg, rows, pages)
	if status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want clean (well-formed pair); results %+v", status, out.Results)
	}
	if len(client.queries) != 2 || client.queries[0].Dimensions[0] != "page" {
		t.Errorf("want page query then query×page, got %d calls", len(client.queries))
	}
	if out.PagesFetched != 3 || len(fetcher.requested) != 3 {
		t.Errorf("requested %v, want the 3 top pages (members already fetched are not refetched)", fetcher.requested)
	}
	if len(out.Results) != 0 {
		t.Errorf("results = %+v, want none (x-default present, links reciprocal)", out.Results)
	}
}

func TestHreflangCommand_DiscoveryRespectsMaxPagesAndOffHost(t *testing.T) {
	cfg := writeHreflangConfig(t, "")
	pages := map[string]httpprobe.Page{
		hlEN: {URL: hlEN, FinalURL: hlEN, Status: 200, Alternates: []httpprobe.Alternate{alt("en", hlEN), alt("es", "https://other.example/es")}},
	}
	rows := map[string][]gsc.SearchAnalyticsRow{
		"page": {{Keys: []string{hlEN}, Impressions: 10}, {Keys: []string{hlES}, Impressions: 5}},
	}
	client := &fakeDimensionClient{byDims: rows}
	var fetcher *fakeFetcher
	stdout := &bytes.Buffer{}
	status := runHreflangCommand(hreflangParams{
		ConfigPath: cfg, Format: diagcmd.FormatJSON, Days: 28, MaxPages: 1, MinImpressions: 10,
		Factory: func() (gsc.SearchAPI, func(), error) { return client, func() {}, nil },
		Fetcher: func(allow func(string) bool) pageFetcher {
			fetcher = &fakeFetcher{allow: allow, pages: pages}
			return fetcher
		},
		Stdout: stdout, Stderr: &bytes.Buffer{}, Now: time.Now(),
	})
	if status != diagcmd.ExitIssues {
		t.Fatalf("status = %d, want issues", status)
	}
	if len(fetcher.requested) != 1 || fetcher.requested[0] != hlEN {
		t.Errorf("requested %v, want only the top page (off-host member refused)", fetcher.requested)
	}
	var out HreflangOutput
	_ = json.Unmarshal(stdout.Bytes(), &out)
	found := false
	for _, r := range out.Results {
		if r.Issue == "wrong_target" && r.Page == "https://other.example/es" {
			found = true
		}
	}
	if !found || out.PagesFetched != 1 {
		t.Errorf("want wrong_target for the off-host alternate and pages_fetched 1, got %+v", out)
	}
}

func TestHreflangCommand_NoPairsInfoOnly(t *testing.T) {
	cfg := writeHreflangConfig(t, "")
	rows := map[string][]gsc.SearchAnalyticsRow{"page": {{Keys: []string{"https://www.x.app/"}, Impressions: 10}}}
	status, out, _, client := runHreflang(t, cfg, rows, nil)
	if status != diagcmd.ExitClean {
		t.Fatalf("status = %d, want clean", status)
	}
	if len(out.Results) != 1 || out.Results[0].Issue != "no_hreflang" {
		t.Errorf("results = %+v", out.Results)
	}
	if len(client.queries) != 1 {
		t.Errorf("no pairs → no query×page call; calls = %d", len(client.queries))
	}
}
