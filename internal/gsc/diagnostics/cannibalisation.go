// Package diagnostics implements the GSC SEO signal predicates as pure
// functions over slices of search-analytics rows. Each predicate matches the
// canonical vocabulary defined in CONTEXT.md and has no I/O, no logging, and
// no flag-handling: callers pass rows in and receive a classified result out.
package diagnostics

import (
	"sort"

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
	type qpKey struct {
		query string
		page  string
	}
	agg := make(map[qpKey]int64)
	queryPages := make(map[string]map[string]struct{})

	for _, row := range rows {
		if len(row.Keys) != 2 {
			continue
		}
		query, page := row.Keys[0], row.Keys[1]
		if query == "" || page == "" {
			continue
		}
		key := qpKey{query: query, page: page}
		agg[key] += row.Impressions
		if _, ok := queryPages[query]; !ok {
			queryPages[query] = make(map[string]struct{})
		}
		queryPages[query][page] = struct{}{}
	}

	results := make([]CannibalisationResult, 0)
	for query, pages := range queryPages {
		qualifying := make([]PageImpressions, 0, len(pages))
		for page := range pages {
			impressions := agg[qpKey{query: query, page: page}]
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
