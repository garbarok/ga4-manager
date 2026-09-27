package diagnostics

import (
	"testing"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

const (
	enURL = "https://www.x.app/calculator/mortgage-calculator"
	esURL = "https://www.x.app/calculator/calculadora-hipoteca"
)

func okPage(u string, alts ...HreflangAlt) HreflangPage {
	return HreflangPage{URL: u, FinalURL: u, Status: 200, Alternates: alts}
}

func enES() map[string]string { return map[string]string{"en": enURL, "es": esURL} }

func findIssue(fs []HreflangFinding, issue, page string) *HreflangFinding {
	for i := range fs {
		if fs[i].Issue == issue && (page == "" || fs[i].Page == page) {
			return &fs[i]
		}
	}
	return nil
}

func TestHreflang_CleanPairOnlyNotesXDefault(t *testing.T) {
	pages := map[string]HreflangPage{
		enURL: okPage(enURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", esURL + "/"}),
		esURL: okPage(esURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", esURL}),
	}
	got := Hreflang(HreflangInput{Pairs: []map[string]string{enES()}, Pages: pages, MinImpressions: 10})
	if len(got) != 1 || got[0].Issue != HreflangMissingXDefault || got[0].Severity != SeverityInfo {
		t.Fatalf("want only the missing_x_default info note, got %+v", got)
	}
}

func TestHreflang_OneWayAnnotation(t *testing.T) {
	// EN lists ES; ES lists only itself.
	pages := map[string]HreflangPage{
		enURL: okPage(enURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", esURL}, HreflangAlt{"x-default", enURL}),
		esURL: okPage(esURL, HreflangAlt{"es", esURL}),
	}
	got := Hreflang(HreflangInput{Pairs: []map[string]string{enES()}, Pages: pages})
	f := findIssue(got, HreflangMissingReturnLink, esURL)
	if f == nil || f.Severity != SeverityWarning {
		t.Fatalf("want missing_return_link on the Spanish page, got %+v", got)
	}
	if findIssue(got, HreflangMissingReturnLink, enURL) != nil {
		t.Errorf("English page links both ways; no finding expected on it: %+v", got)
	}
	if findIssue(got, HreflangMissingXDefault, "") != nil {
		t.Errorf("x-default is present on the EN page")
	}
}

func TestHreflang_MissingSelfReference(t *testing.T) {
	pages := map[string]HreflangPage{
		enURL: okPage(enURL, HreflangAlt{"es", esURL}),
		esURL: okPage(esURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", esURL}),
	}
	got := Hreflang(HreflangInput{Pairs: []map[string]string{enES()}, Pages: pages})
	if findIssue(got, HreflangMissingSelfReference, enURL) == nil {
		t.Errorf("want missing_self_reference on EN, got %+v", got)
	}
}

func TestHreflang_WrongTargetAndOffHost(t *testing.T) {
	pages := map[string]HreflangPage{
		enURL: okPage(enURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", "https://other.example/es"}),
		esURL: {URL: esURL, Status: 404},
	}
	got := Hreflang(HreflangInput{Pairs: []map[string]string{enES()}, Pages: pages})
	if findIssue(got, HreflangWrongTarget, enURL) == nil {
		t.Errorf("EN's es annotation points off-site: want wrong_target, got %+v", got)
	}
	if findIssue(got, HreflangWrongTarget, esURL) == nil {
		t.Errorf("ES member answers 404: want wrong_target, got %+v", got)
	}

	// A discovered member on another host is refused, never fetched.
	offHost := map[string]HreflangPage{
		enURL:                      okPage(enURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", "https://other.example/es"}),
		"https://other.example/es": {URL: "https://other.example/es", OffHost: true, FetchErr: "off-host URL refused"},
	}
	got = Hreflang(HreflangInput{Pairs: []map[string]string{{"en": enURL, "es": "https://other.example/es"}}, Pages: offHost})
	if f := findIssue(got, HreflangWrongTarget, "https://other.example/es"); f == nil {
		t.Errorf("want wrong_target for the off-host member, got %+v", got)
	}
}

func TestHreflang_CrossLanguageRanking(t *testing.T) {
	pages := map[string]HreflangPage{
		enURL: okPage(enURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", esURL}, HreflangAlt{"x-default", enURL}),
		esURL: okPage(esURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", esURL}),
	}
	rows := []gsc.SearchAnalyticsRow{
		{Keys: []string{"how much house can i afford calculator", esURL}, Impressions: 25},
		{Keys: []string{"simulador hipoteca", esURL}, Impressions: 700},                 // right page
		{Keys: []string{"mortgage payment simulator", esURL}, Impressions: 5},           // below threshold
		{Keys: []string{"zillow", esURL}, Impressions: 100},                             // no language evidence
		{Keys: []string{"calculadora hipoteca", enURL}, Impressions: 40},                // es query on en page
		{Keys: []string{"mortgage calculator", "https://www.x.app/"}, Impressions: 999}, // not a pair member
	}
	got := Hreflang(HreflangInput{Pairs: []map[string]string{enES()}, Pages: pages, QueryRows: rows, MinImpressions: 10})

	var cross []HreflangFinding
	for _, f := range got {
		if f.Issue == HreflangCrossLanguageRanking {
			cross = append(cross, f)
		}
	}
	if len(cross) != 2 {
		t.Fatalf("want 2 cross-language findings, got %+v", cross)
	}
	// Sorted by impressions: the es query on the en page (40) first.
	if cross[0].Query != "calculadora hipoteca" || cross[0].ExpectedPage != esURL {
		t.Errorf("first = %+v", cross[0])
	}
	if cross[1].Query != "how much house can i afford calculator" || cross[1].ExpectedPage != enURL || cross[1].Impressions != 25 {
		t.Errorf("second = %+v", cross[1])
	}
}

func TestHreflang_UnsupportedLanguageSkipsCrossCheck(t *testing.T) {
	jaURL := "https://www.x.app/ja/calc"
	pair := map[string]string{"en": enURL, "ja": jaURL}
	pages := map[string]HreflangPage{
		enURL: okPage(enURL, HreflangAlt{"en", enURL}, HreflangAlt{"ja", jaURL}, HreflangAlt{"x-default", enURL}),
		jaURL: okPage(jaURL, HreflangAlt{"en", enURL}, HreflangAlt{"ja", jaURL}),
	}
	got := Hreflang(HreflangInput{Pairs: []map[string]string{pair}, Pages: pages,
		QueryRows: []gsc.SearchAnalyticsRow{{Keys: []string{"mortgage calculator", jaURL}, Impressions: 50}}, MinImpressions: 10})
	if len(got) != 1 || got[0].Issue != HreflangLanguageCheckSkipped || got[0].Severity != SeverityInfo {
		t.Fatalf("want one language_check_skipped note, got %+v", got)
	}
}

func TestHreflang_NoPairs(t *testing.T) {
	got := Hreflang(HreflangInput{})
	if len(got) != 1 || got[0].Issue != HreflangNoHreflang || got[0].Severity != SeverityInfo {
		t.Fatalf("got %+v", got)
	}
}

func TestDiscoverHreflangPairs(t *testing.T) {
	pages := []HreflangPage{
		okPage(enURL, HreflangAlt{"en", enURL}, HreflangAlt{"es", esURL}, HreflangAlt{"x-default", enURL}),
		okPage(esURL, HreflangAlt{"es", esURL + "/"}, HreflangAlt{"en", enURL}), // same set, different order/slash
		okPage("https://www.x.app/about"), // no annotations
		okPage("https://www.x.app/solo", HreflangAlt{"en", "https://www.x.app/solo"}),
	}
	pairs := DiscoverHreflangPairs(pages)
	if len(pairs) != 1 || pairs[0]["es"] != esURL || pairs[0]["en"] != enURL {
		t.Fatalf("pairs = %+v", pairs)
	}
}
