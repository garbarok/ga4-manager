package diagnostics

import (
	"testing"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

func hygRow(u string, impressions int64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{Keys: []string{u}, Impressions: impressions}
}

func TestURLHygiene_Classification(t *testing.T) {
	hosts := []string{"example.com"}
	tests := []struct {
		name  string
		url   string
		extra []string // other URLs present in the report
		want  string
	}{
		{"repeated host segment", "https://www.example.com/www.example.com/calculator/x", nil, HygieneMalformedPath},
		{"double slash", "https://www.example.com/blog//post", nil, HygieneMalformedPath},
		{"fragment", "https://www.example.com/blog/post#section", nil, HygieneFragment},
		{"og image with query is asset_route not query_duplicate", "https://www.example.com/calculator/x/opengraph-image?abc",
			[]string{"https://www.example.com/calculator/x/opengraph-image"}, HygieneAssetRoute},
		{"twitter image", "https://www.example.com/twitter-image", nil, HygieneAssetRoute},
		{"apple icon", "https://www.example.com/apple-icon", nil, HygieneAssetRoute},
		{"next static", "https://www.example.com/_next/static/chunk.js", nil, HygieneAssetRoute},
		{"query duplicate", "https://www.example.com/pricing?ref=nav", []string{"https://www.example.com/pricing"}, HygieneQueryDuplicate},
		{"query without clean twin is fine", "https://www.example.com/search?q=x", nil, ""},
		{"privacy", "https://www.example.com/privacy", nil, HygieneUtilityPage},
		{"contact", "https://www.example.com/contact", nil, HygieneUtilityPage},
		{"clean content page", "https://www.example.com/calculator/mortgage-calculator", nil, ""},
		{"host-like word that is not the site host", "https://www.example.com/blog/example-com-review", nil, ""},
		{"malformed wins over fragment", "https://www.example.com/www.example.com/a#b", nil, HygieneMalformedPath},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows := []gsc.SearchAnalyticsRow{hygRow(tt.url, 10)}
			for _, e := range tt.extra {
				rows = append(rows, hygRow(e, 10))
			}
			got := URLHygiene(rows, hosts)
			var issue string
			for _, f := range got {
				if f.URL == tt.url {
					issue = f.Issue
				}
			}
			if issue != tt.want {
				t.Errorf("issue = %q, want %q (findings %+v)", issue, tt.want, got)
			}
		})
	}
}

func TestURLHygiene_SeverityFixAndOrdering(t *testing.T) {
	got := URLHygiene([]gsc.SearchAnalyticsRow{
		hygRow("https://example.com/privacy", 500),
		hygRow("https://example.com/a#x", 10),
		hygRow("https://example.com/b/opengraph-image", 60),
		hygRow("https://example.com/clean", 9999),
	}, []string{"example.com"})

	if len(got) != 3 {
		t.Fatalf("got %d findings, want 3: %+v", len(got), got)
	}
	wantOrder := []string{"https://example.com/b/opengraph-image", "https://example.com/a#x", "https://example.com/privacy"}
	for i, u := range wantOrder {
		if got[i].URL != u {
			t.Errorf("position %d = %s, want %s", i, got[i].URL, u)
		}
		if got[i].Fix == "" {
			t.Errorf("%s has no fix text", got[i].URL)
		}
	}
	if got[2].Severity != SeverityInfo || got[0].Severity != SeverityWarning {
		t.Errorf("severities = %s/%s, want warning/info", got[0].Severity, got[2].Severity)
	}
}

func TestURLHygiene_CleanSite(t *testing.T) {
	if got := URLHygiene([]gsc.SearchAnalyticsRow{hygRow("https://example.com/", 100)}, []string{"example.com"}); len(got) != 0 {
		t.Errorf("want no findings, got %+v", got)
	}
}
