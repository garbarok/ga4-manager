package diagnostics

import (
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

// Hreflang issue types (see specs/gsc-hreflang).
const (
	HreflangMissingReturnLink    = "missing_return_link"
	HreflangMissingSelfReference = "missing_self_reference"
	HreflangWrongTarget          = "wrong_target"
	HreflangMissingXDefault      = "missing_x_default"
	HreflangCrossLanguageRanking = "cross_language_ranking"
	HreflangNoHreflang           = "no_hreflang"
	// HreflangLanguageCheckSkipped notes a pair whose languages the query
	// scorer does not support, so cross-language ranking was not checked.
	HreflangLanguageCheckSkipped = "language_check_skipped"
)

const xDefault = "x-default"

// HreflangAlt is one hreflang annotation read from a page.
type HreflangAlt struct {
	Lang string
	Href string
}

// HreflangPage is what was observed when fetching one URL.
type HreflangPage struct {
	URL        string
	FinalURL   string
	Status     int
	Alternates []HreflangAlt
	// FetchErr is set when the page could not be fetched at all (network
	// error, off-host redirect, redirect cap). OffHost marks refusals.
	FetchErr string
	OffHost  bool
}

// HreflangFinding is one hreflang integrity or ranking problem.
type HreflangFinding struct {
	Pair         map[string]string
	Page         string
	Issue        string
	Severity     string
	Detail       string
	Query        string
	ExpectedPage string
	Impressions  int64
}

// HreflangInput bundles what the diagnostic needs.
type HreflangInput struct {
	// Pairs maps language code → absolute URL for each translated page set.
	Pairs []map[string]string
	// Pages holds every fetched URL, keyed by the URL as requested.
	Pages map[string]HreflangPage
	// QueryRows are [query, page] Search Analytics rows for the window.
	QueryRows []gsc.SearchAnalyticsRow
	// MinImpressions is the cross-language ranking threshold.
	MinImpressions int64
}

// NormalizeHreflangURL makes URLs comparable: lowercased scheme and host,
// fragment dropped, trailing slash stripped (except the root).
func NormalizeHreflangURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return raw
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Fragment = ""
	u.RawFragment = ""
	if len(u.Path) > 1 {
		u.Path = strings.TrimRight(u.Path, "/")
		u.RawPath = ""
	}
	return u.String()
}

// Hreflang checks each pair's annotations and cross-language ranking.
func Hreflang(in HreflangInput) []HreflangFinding {
	if len(in.Pairs) == 0 {
		return []HreflangFinding{{
			Issue:    HreflangNoHreflang,
			Severity: SeverityInfo,
			Detail:   "No hreflang pairs declared in config and no fetched page declares hreflang alternates.",
		}}
	}

	var findings []HreflangFinding
	selfChecked := make(map[string]bool)

	for _, pair := range in.Pairs {
		langs := sortedLangs(pair)
		members := make(map[string]string, len(pair)) // normalized URL → lang
		for _, lang := range langs {
			members[NormalizeHreflangURL(pair[lang])] = lang
		}

		hasXDefault := false
		for _, lang := range langs {
			memberURL := pair[lang]
			page, fetched := in.Pages[memberURL]
			if !fetched {
				continue
			}
			if f, bad := unreachableMember(pair, lang, page); bad {
				findings = append(findings, f)
				continue
			}

			if !selfChecked[memberURL] {
				selfChecked[memberURL] = true
				if !listsURL(page.Alternates, memberURL, page.FinalURL) {
					findings = append(findings, HreflangFinding{
						Pair: pair, Page: memberURL, Issue: HreflangMissingSelfReference, Severity: SeverityWarning,
						Detail: "Page does not list itself in its hreflang annotations.",
					})
				}
			}

			for _, alt := range page.Alternates {
				if strings.EqualFold(alt.Lang, xDefault) {
					hasXDefault = true
					continue
				}
				// An annotation for a pair language must point at that pair member.
				if want, ok := pair[alt.Lang]; ok && NormalizeHreflangURL(alt.Href) != NormalizeHreflangURL(want) {
					findings = append(findings, HreflangFinding{
						Pair: pair, Page: memberURL, Issue: HreflangWrongTarget, Severity: SeverityWarning,
						Detail: fmt.Sprintf("hreflang=%q points to %s, expected %s.", alt.Lang, alt.Href, want),
					})
				}
			}

			for _, other := range langs {
				if other == lang {
					continue
				}
				otherURL := pair[other]
				if listsURL(page.Alternates, otherURL, "") {
					continue
				}
				detail := fmt.Sprintf("Does not list the %s alternate %s.", other, otherURL)
				if op, ok := in.Pages[otherURL]; ok && listsURL(op.Alternates, memberURL, page.FinalURL) {
					detail = fmt.Sprintf("The %s page %s lists this page, but this page does not link back.", other, otherURL)
				}
				findings = append(findings, HreflangFinding{
					Pair: pair, Page: memberURL, Issue: HreflangMissingReturnLink, Severity: SeverityWarning, Detail: detail,
				})
			}
		}

		if !hasXDefault {
			findings = append(findings, HreflangFinding{
				Pair: pair, Page: pair[langs[0]], Issue: HreflangMissingXDefault, Severity: SeverityInfo,
				Detail: "No page in the pair declares an x-default alternate.",
			})
		}

		findings = append(findings, crossLanguage(pair, langs, members, in.QueryRows, in.MinImpressions)...)
	}

	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].Severity != findings[j].Severity {
			return findings[i].Severity == SeverityWarning
		}
		if findings[i].Impressions != findings[j].Impressions {
			return findings[i].Impressions > findings[j].Impressions
		}
		if findings[i].Page != findings[j].Page {
			return findings[i].Page < findings[j].Page
		}
		return findings[i].Issue < findings[j].Issue
	})
	return findings
}

// unreachableMember reports a pair member that cannot be served: refused
// off-host, failed to fetch, or not 200 after redirects.
func unreachableMember(pair map[string]string, lang string, page HreflangPage) (HreflangFinding, bool) {
	var detail string
	switch {
	case page.OffHost:
		detail = fmt.Sprintf("hreflang=%q target %s is not on the configured site; not fetched.", lang, page.URL)
	case page.FetchErr != "":
		detail = fmt.Sprintf("hreflang=%q target %s could not be fetched: %s.", lang, page.URL, page.FetchErr)
	case page.Status != 200:
		detail = fmt.Sprintf("hreflang=%q target %s answered HTTP %d.", lang, page.URL, page.Status)
	default:
		return HreflangFinding{}, false
	}
	return HreflangFinding{Pair: pair, Page: page.URL, Issue: HreflangWrongTarget, Severity: SeverityWarning, Detail: detail}, true
}

func crossLanguage(pair map[string]string, langs []string, members map[string]string, rows []gsc.SearchAnalyticsRow, minImpressions int64) []HreflangFinding {
	var candidates []string
	for _, lang := range langs {
		if !SupportedQueryLanguage(lang) {
			return []HreflangFinding{{
				Pair: pair, Page: pair[langs[0]], Issue: HreflangLanguageCheckSkipped, Severity: SeverityInfo,
				Detail: fmt.Sprintf("Cross-language ranking not checked: language %q is not supported by the query scorer.", lang),
			}}
		}
		candidates = append(candidates, lang)
	}

	byBase := make(map[string]string, len(langs)) // base lang → member URL
	for _, lang := range langs {
		byBase[BaseLanguage(lang)] = pair[lang]
	}

	var out []HreflangFinding
	for _, r := range rows {
		if len(r.Keys) != 2 || r.Impressions < minImpressions {
			continue
		}
		pageLang, ok := members[NormalizeHreflangURL(r.Keys[1])]
		if !ok {
			continue
		}
		qLang := InferQueryLanguage(r.Keys[0], candidates)
		if qLang == "" || qLang == BaseLanguage(pageLang) {
			continue
		}
		expected, ok := byBase[qLang]
		if !ok {
			continue
		}
		out = append(out, HreflangFinding{
			Pair: pair, Page: r.Keys[1], Issue: HreflangCrossLanguageRanking, Severity: SeverityWarning,
			Detail:       fmt.Sprintf("%s query ranks on the %s page; the %s page should rank instead.", qLang, BaseLanguage(pageLang), qLang),
			Query:        r.Keys[0],
			ExpectedPage: expected,
			Impressions:  r.Impressions,
		})
	}
	return out
}

func listsURL(alts []HreflangAlt, target, alsoTarget string) bool {
	want := NormalizeHreflangURL(target)
	also := ""
	if alsoTarget != "" {
		also = NormalizeHreflangURL(alsoTarget)
	}
	for _, a := range alts {
		if strings.EqualFold(a.Lang, xDefault) {
			continue
		}
		n := NormalizeHreflangURL(a.Href)
		if n == want || (also != "" && n == also) {
			return true
		}
	}
	return false
}

func sortedLangs(pair map[string]string) []string {
	langs := make([]string, 0, len(pair))
	for l := range pair {
		if !strings.EqualFold(l, xDefault) {
			langs = append(langs, l)
		}
	}
	sort.Strings(langs)
	return langs
}

// DiscoverHreflangPairs builds pairs from fetched pages' own annotations:
// each page with ≥2 non-x-default alternates contributes one pair (lang →
// href). Pairs with the same member set are merged into one.
func DiscoverHreflangPairs(pages []HreflangPage) []map[string]string {
	seen := make(map[string]bool)
	var pairs []map[string]string
	for _, p := range pages {
		pair := make(map[string]string)
		for _, a := range p.Alternates {
			if strings.EqualFold(a.Lang, xDefault) {
				continue
			}
			pair[a.Lang] = a.Href
		}
		if len(pair) < 2 {
			continue
		}
		keyParts := make([]string, 0, len(pair))
		for _, l := range sortedLangs(pair) {
			keyParts = append(keyParts, l+"="+NormalizeHreflangURL(pair[l]))
		}
		key := strings.Join(keyParts, "|")
		if seen[key] {
			continue
		}
		seen[key] = true
		pairs = append(pairs, pair)
	}
	return pairs
}
