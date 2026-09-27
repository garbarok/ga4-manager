package diagnostics

import (
	"math"
	"testing"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

func pageRow(page string, position, ctr float64, impressions int64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{
		Keys:        []string{page},
		Impressions: impressions,
		Clicks:      int64(math.Round(ctr * float64(impressions))),
		CTR:         ctr,
		Position:    position,
	}
}

// The motivating case: a 100k-impression page at 8.8 with 0.5% CTR
// shares bucket 9 with only the homepage once low-impression pages are
// floored out. Two peers is below PageMinPeers, so the baseline decides.
func TestOpportunityWith_PageModeLargePageFallsBackToBaseline(t *testing.T) {
	rows := []gsc.SearchAnalyticsRow{
		pageRow("https://x.app/calculator/mortgage-calculator", 8.8, 0.005, 100000),
		pageRow("https://x.app/", 9.4, 0.08, 2000),
	}
	got := OpportunityWith(rows, OpportunityOptions{MinPeers: PageMinPeers})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1: %+v", len(got), got)
	}
	r := got[0]
	if r.Page != "https://x.app/calculator/mortgage-calculator" || r.Query != "" {
		t.Fatalf("unexpected result %+v", r)
	}
	if r.MedianSource != MedianSourceBaseline {
		t.Errorf("median_source = %q, want baseline", r.MedianSource)
	}
	if r.CategoryMedianCTR != baselineCTRByBucket[9] {
		t.Errorf("category_median_ctr = %v, want bucket-9 baseline %v", r.CategoryMedianCTR, baselineCTRByBucket[9])
	}
	want := int64(math.Round(100000 * (baselineCTRByBucket[9] - 0.005)))
	if r.PotentialClicks != want {
		t.Errorf("potential_clicks = %d, want %d", r.PotentialClicks, want)
	}
}

// Under the query-mode rule (2 peers) the same two pages would use their own
// midpoint as the median — confirming the page rule is what changes outcome.
func TestOpportunityWith_TwoPeersUseSiteMedianInQueryRule(t *testing.T) {
	rows := []gsc.SearchAnalyticsRow{
		pageRow("https://x.app/a", 8.8, 0.005, 100000),
		pageRow("https://x.app/", 9.4, 0.08, 2000),
	}
	got := OpportunityWith(rows, OpportunityOptions{MinPeers: DefaultMinPeers})
	if len(got) != 1 || got[0].MedianSource != MedianSourceSite {
		t.Fatalf("want one site-median result, got %+v", got)
	}
}

func TestOpportunityWith_PageModeThreePeersUseSiteMedian(t *testing.T) {
	rows := []gsc.SearchAnalyticsRow{
		pageRow("https://x.app/a", 9.0, 0.010, 5000),
		pageRow("https://x.app/b", 9.1, 0.050, 3000),
		pageRow("https://x.app/c", 8.9, 0.060, 2000),
	}
	got := OpportunityWith(rows, OpportunityOptions{MinPeers: PageMinPeers})
	if len(got) != 1 {
		t.Fatalf("got %d results, want 1: %+v", len(got), got)
	}
	if got[0].Page != "https://x.app/a" || got[0].MedianSource != MedianSourceSite {
		t.Errorf("unexpected result %+v", got[0])
	}
	if got[0].CategoryMedianCTR != 0.050 {
		t.Errorf("category_median_ctr = %v, want 0.050", got[0].CategoryMedianCTR)
	}
}

func TestBreakdownByPageAndAnonymizedShare(t *testing.T) {
	rows := []gsc.SearchAnalyticsRow{
		{Keys: []string{"q1", "https://x.app/a"}, Impressions: 20000, Clicks: 100},
		{Keys: []string{"q2", "https://x.app/a"}, Impressions: 10000, Clicks: 50},
		{Keys: []string{"q3", "https://x.app/b"}, Impressions: 5, Clicks: 0},
	}
	for i := 0; i < 6; i++ {
		rows = append(rows, gsc.SearchAnalyticsRow{Keys: []string{string(rune('m' + i)), "https://x.app/a"}, Impressions: 0})
	}
	b := BreakdownByPage(rows, 5)
	a := b["https://x.app/a"]
	if a.DisclosedImpressions != 30000 {
		t.Errorf("disclosed = %d, want 30000", a.DisclosedImpressions)
	}
	if len(a.TopQueries) != 5 || a.TopQueries[0].Query != "q1" || a.TopQueries[1].Query != "q2" {
		t.Errorf("top queries = %+v", a.TopQueries)
	}

	if got := AnonymizedShare(200000, a.DisclosedImpressions); math.Abs(got-0.85) > 1e-9 {
		t.Errorf("anonymized_share = %v, want 0.85", got)
	}
	if got := AnonymizedShare(100, 150); got != 0 {
		t.Errorf("clamp low: got %v, want 0", got)
	}
	if got := AnonymizedShare(0, 0); got != 0 {
		t.Errorf("zero impressions: got %v, want 0", got)
	}
}

// Fragment URLs with no clicks outnumber real pages in bucket 6, so the site
// median is 0 — without the floor nothing in the bucket could be flagged.
func TestOpportunityWith_BaselineFloorBeatsZeroSiteMedian(t *testing.T) {
	rows := []gsc.SearchAnalyticsRow{
		pageRow("https://x.app/calculator/calculadora-hipoteca", 6.4, 0.015, 50000),
		pageRow("https://x.app/blog/post#a", 6.0, 0, 10),
		pageRow("https://x.app/blog/post#b", 6.2, 0, 10),
		pageRow("https://x.app/blog/post#c", 6.2, 0, 10),
	}

	if got := OpportunityWith(rows, OpportunityOptions{MinPeers: PageMinPeers}); len(got) != 0 {
		t.Fatalf("without the floor the 0%% median hides everything, got %+v", got)
	}

	got := OpportunityWith(rows, OpportunityOptions{MinPeers: PageMinPeers, BaselineFloor: true})
	// The 0-CTR fragments are below the baseline too (1 potential click
	// each, dropped later by --min-potential-clicks); the simulador leads.
	if len(got) == 0 || got[0].Page != "https://x.app/calculator/calculadora-hipoteca" {
		t.Fatalf("want the simulador page first, got %+v", got)
	}
	if got[0].MedianSource != MedianSourceBaseline || got[0].CategoryMedianCTR != baselineCTRByBucket[6] {
		t.Errorf("want bucket-6 baseline, got %+v", got[0])
	}
}

func TestOpportunityWith_BaselineFloorKeepsHigherSiteMedian(t *testing.T) {
	// Site median 0.10 > bucket-9 baseline 0.035: the site's own curve wins.
	rows := []gsc.SearchAnalyticsRow{
		pageRow("https://x.app/a", 9.0, 0.02, 5000),
		pageRow("https://x.app/b", 9.1, 0.10, 3000),
		pageRow("https://x.app/c", 8.9, 0.12, 2000),
	}
	got := OpportunityWith(rows, OpportunityOptions{MinPeers: PageMinPeers, BaselineFloor: true})
	if len(got) != 1 || got[0].MedianSource != MedianSourceSite || got[0].CategoryMedianCTR != 0.10 {
		t.Fatalf("want site median 0.10 kept, got %+v", got)
	}
}
