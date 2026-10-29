// Package diagnostics implements the GSC SEO signal predicates as pure
// functions over slices of search-analytics rows. Each predicate matches the
// canonical vocabulary defined in CONTEXT.md and has no I/O, no logging, and
// no flag-handling: callers pass rows in and receive a classified result out.
package diagnostics

import (
	"sort"
	"strings"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

// DefaultMinImpressions is the threshold below which a page does not count as
// a participant in a cannibalising query, per the CONTEXT.md predicate
// "cannibalisation := >=2 pages on the same query with impressions >= 10".
const DefaultMinImpressions int64 = 10

// PageImpressions is one page's impression total for a given query.
type PageImpressions struct {
	Page        string
	Impressions int64
}

// CannibalisationResult is one query that satisfies the cannibalisation
// predicate: at least two pages on the same query each with impressions at or
// above the configured threshold.
//
// Pages are sorted by impressions descending then by page URL ascending so
// the rendering is deterministic. CanonicalCandidate is the page with the
// highest impressions on the query (i.e. Pages[0].Page).
type CannibalisationResult struct {
	Query              string
	Pages              []PageImpressions
	TotalImpressions   int64
	CanonicalCandidate string
	// CrossLanguage is true when the qualifying pages are spread across
	// distinct locales with no single locale holding two or more of them — i.e.
	// the "competition" is really a set of hreflang translations of one another,
	// not same-language cannibalisation. Set by MarkCrossLanguage.
	CrossLanguage bool
}

// Cannibalisation classifies rows under the cannibalisation predicate.
//
// Input is a slice of rows whose Keys are [query, page]; rows in any other
// shape are skipped. Pages whose Impressions are below minImpressions do not
// count toward the threshold check. A query qualifies when at least two
// distinct pages on it clear the threshold; for those queries, only the
// qualifying pages are returned.
//
// Results are sorted by TotalImpressions descending, then by Query ascending
// for a stable tie-breaker. The function is pure: no I/O, no logging, safe to
// call from anywhere.
func Cannibalisation(rows []gsc.SearchAnalyticsRow, minImpressions int64) []CannibalisationResult {
	if minImpressions < 1 {
		minImpressions = DefaultMinImpressions
	}

	// Aggregate impressions per (query, page). The same query+page can appear
	// in more than one row if upstream callers concatenate ranges, so we sum.
	agg := make(map[string]map[string]int64)
	for _, row := range rows {
		if len(row.Keys) != 2 {
			continue
		}
		query, page := row.Keys[0], row.Keys[1]
		if query == "" || page == "" {
			continue
		}
		if agg[query] == nil {
			agg[query] = make(map[string]int64)
		}
		agg[query][page] += row.Impressions
	}

	results := make([]CannibalisationResult, 0)
	for query, pages := range agg {
		qualifying := make([]PageImpressions, 0, len(pages))
		for page, impressions := range pages {
			if impressions >= minImpressions {
				qualifying = append(qualifying, PageImpressions{Page: page, Impressions: impressions})
			}
		}
		if len(qualifying) < 2 {
			continue
		}

		sort.SliceStable(qualifying, func(i, j int) bool {
			if qualifying[i].Impressions != qualifying[j].Impressions {
				return qualifying[i].Impressions > qualifying[j].Impressions
			}
			return qualifying[i].Page < qualifying[j].Page
		})

		var total int64
		for _, p := range qualifying {
			total += p.Impressions
		}

		results = append(results, CannibalisationResult{
			Query:              query,
			Pages:              qualifying,
			TotalImpressions:   total,
			CanonicalCandidate: qualifying[0].Page,
		})
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].TotalImpressions != results[j].TotalImpressions {
			return results[i].TotalImpressions > results[j].TotalImpressions
		}
		return results[i].Query < results[j].Query
	})

	return results
}

// knownLocalePrefixes are ISO-639-1 language codes recognised as a leading URL
// path segment denoting a localised variant (e.g. /en/blog/x). The set is
// intentionally broad; an unrecognised first segment is treated as the
// default (unprefixed) locale, which is the common single-prefix i18n layout
// where the default language has no path prefix.
var knownLocalePrefixes = map[string]bool{
	"en": true, "es": true, "fr": true, "de": true, "it": true, "pt": true,
	"nl": true, "ja": true, "zh": true, "ru": true, "ar": true, "ko": true,
	"pl": true, "tr": true, "sv": true, "da": true, "no": true, "fi": true,
	"cs": true, "el": true, "he": true, "hi": true, "id": true, "th": true,
	"uk": true, "vi": true, "ro": true, "hu": true, "ca": true, "gl": true,
	"eu": true, "nb": true, "sk": true, "bg": true, "hr": true, "lt": true,
	"lv": true, "et": true, "sl": true, "sr": true, "fa": true, "ms": true,
}

// PageLocale infers a page's locale from its leading URL path segment.
// "/en/blog/x" and "https://site.com/en/blog/x" both return "en"; a page with
// no recognised locale prefix (e.g. "/blog/x") is a default-locale page and
// returns "" (empty string). Accepts region-qualified codes like "pt-br" by
// matching on the language sub-tag.
func PageLocale(page string) string {
	p := page
	// Strip scheme://host if present.
	if i := strings.Index(p, "://"); i >= 0 {
		rest := p[i+3:]
		if j := strings.IndexByte(rest, '/'); j >= 0 {
			p = rest[j:]
		} else {
			p = "/"
		}
	}
	p = strings.TrimPrefix(p, "/")
	seg := p
	if i := strings.IndexByte(p, '/'); i >= 0 {
		seg = p[:i]
	}
	seg = strings.ToLower(seg)
	base := seg
	if i := strings.IndexByte(seg, '-'); i >= 0 {
		base = seg[:i]
	}
	if knownLocalePrefixes[base] {
		return base
	}
	return ""
}

// MarkCrossLanguage sets CrossLanguage on each result in place. A result is
// cross-language when its qualifying pages occupy at least two distinct
// locales and no single locale holds two or more of them — meaning the pages
// are translations of one another (legitimate, disambiguated by hreflang)
// rather than same-language duplicates competing for the same query.
//
// A query with two same-language pages plus one translation stays actionable
// (CrossLanguage = false): the same-language pair is real cannibalisation.
func MarkCrossLanguage(results []CannibalisationResult) {
	for i := range results {
		byLocale := make(map[string]int)
		for _, p := range results[i].Pages {
			byLocale[PageLocale(p.Page)]++
		}
		maxPerLocale := 0
		for _, n := range byLocale {
			if n > maxPerLocale {
				maxPerLocale = n
			}
		}
		results[i].CrossLanguage = len(byLocale) >= 2 && maxPerLocale < 2
	}
}
