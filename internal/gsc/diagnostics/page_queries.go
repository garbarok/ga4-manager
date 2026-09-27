package diagnostics

import (
	"sort"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

// PageQuery is one query a page ranks for, as surfaced in page-granularity
// opportunity results.
type PageQuery struct {
	Query       string  `json:"query"`
	Impressions int64   `json:"impressions"`
	Clicks      int64   `json:"clicks"`
	Position    float64 `json:"position"`
}

// PageQueryBreakdown summarises the query×page rows GSC disclosed for a page.
type PageQueryBreakdown struct {
	// DisclosedImpressions is Σ impressions over every query×page row for
	// the page. GSC omits anonymized (rare/privacy-filtered) queries from
	// query-dimension reports, so this is ≤ the page-level total.
	DisclosedImpressions int64
	// TopQueries is up to limit queries by impressions desc.
	TopQueries []PageQuery
}

// BreakdownByPage groups [query, page] rows by page, keeping the top `limit`
// queries per page by impressions (ties: clicks desc, query asc).
func BreakdownByPage(rows []gsc.SearchAnalyticsRow, limit int) map[string]PageQueryBreakdown {
	byPage := make(map[string][]PageQuery)
	disclosed := make(map[string]int64)
	for _, r := range rows {
		if len(r.Keys) != 2 || r.Keys[1] == "" {
			continue
		}
		page := r.Keys[1]
		disclosed[page] += r.Impressions
		byPage[page] = append(byPage[page], PageQuery{
			Query:       r.Keys[0],
			Impressions: r.Impressions,
			Clicks:      r.Clicks,
			Position:    r.Position,
		})
	}

	out := make(map[string]PageQueryBreakdown, len(byPage))
	for page, qs := range byPage {
		sort.SliceStable(qs, func(i, j int) bool {
			if qs[i].Impressions != qs[j].Impressions {
				return qs[i].Impressions > qs[j].Impressions
			}
			if qs[i].Clicks != qs[j].Clicks {
				return qs[i].Clicks > qs[j].Clicks
			}
			return qs[i].Query < qs[j].Query
		})
		if len(qs) > limit {
			qs = qs[:limit]
		}
		out[page] = PageQueryBreakdown{DisclosedImpressions: disclosed[page], TopQueries: qs}
	}
	return out
}

// AnonymizedShare is the fraction of a page's impressions that GSC did not
// attribute to any disclosed query: 1 − disclosed/pageImpressions, clamped
// to [0, 1]. A high share means a title rewrite is aimed at a long tail the
// Operator cannot see query-by-query.
func AnonymizedShare(pageImpressions, disclosedImpressions int64) float64 {
	if pageImpressions <= 0 {
		return 0
	}
	share := 1 - float64(disclosedImpressions)/float64(pageImpressions)
	switch {
	case share < 0:
		return 0
	case share > 1:
		return 1
	}
	return share
}
