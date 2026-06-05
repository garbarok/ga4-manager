package diagnostics

import (
	"math"
	"sort"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

// OpportunityResult is one row that satisfies the opportunity predicate: it
// ranks on page 1–2 yet under-converts versus its position-bucket peer group.
//
// Bucket is the integer position bucket (round(Position)) used to group peers.
// CategoryMedianCTR is the median CTR of all rows in that same bucket.
// CTRGap is CategoryMedianCTR − Row.CTR, i.e. how far below the bucket median
// the row sits; always positive for a qualifying row.
type OpportunityResult struct {
	Query             string
	Page              string
	Position          float64
	CTR               float64
	Bucket            int
	CategoryMedianCTR float64
	CTRGap            float64
}

// Opportunity classifies rows under the opportunity predicate.
//
// Predicate (see CONTEXT.md "SEO Diagnostics"):
//
//	opportunity := position ∈ [5, 20] AND ctr < category_median_ctr
//
// Category for v1 is the position bucket: rows are grouped by round(Position)
// and category_median_ctr is the median CTR of the bucket. The [5, 20] bound
// is applied to the integer bucket so the boundary case position=4.5 (which
// rounds to bucket 5) qualifies — the position-CTR curve is defined at integer
// ranks, and the bucket is the predicate's unit of comparison.
//
// A bucket with only one row has no peers and is excluded — a single data
// point cannot be an outlier against itself. A bucket where every CTR equals
// the median (e.g. all rows share the same CTR) yields no qualifying rows by
// the strict-less-than predicate.
//
// The input row Keys may be either [query, page] or [page]; the Query field
// is left empty when only a page is present. Rows whose bucket is outside
// [5, 20] are excluded up front and do not influence other buckets' medians.
//
// Results are ordered by CTRGap descending (largest under-performance first),
// with a deterministic tie-break by Page ascending then Query ascending.
func Opportunity(rows []gsc.SearchAnalyticsRow) []OpportunityResult {
	type entry struct {
		row    gsc.SearchAnalyticsRow
		bucket int
	}

	eligible := make([]entry, 0, len(rows))
	buckets := make(map[int][]float64)

	for _, row := range rows {
		bucket := int(math.Round(row.Position))
		if bucket < 5 || bucket > 20 {
			continue
		}
		eligible = append(eligible, entry{row: row, bucket: bucket})
		buckets[bucket] = append(buckets[bucket], row.CTR)
	}

	medians := make(map[int]float64, len(buckets))
	for bucket, ctrs := range buckets {
		if len(ctrs) < 2 {
			continue
		}
		sorted := append([]float64(nil), ctrs...)
		sort.Float64s(sorted)
		n := len(sorted)
		if n%2 == 1 {
			medians[bucket] = sorted[n/2]
		} else {
			medians[bucket] = (sorted[n/2-1] + sorted[n/2]) / 2.0
		}
	}

	results := make([]OpportunityResult, 0)
	for _, e := range eligible {
		median, ok := medians[e.bucket]
		if !ok {
			continue
		}
		if e.row.CTR >= median {
			continue
		}

		query, page := "", ""
		switch len(e.row.Keys) {
		case 1:
			page = e.row.Keys[0]
		case 2:
			query, page = e.row.Keys[0], e.row.Keys[1]
		default:
			continue
		}
		if page == "" {
			continue
		}

		results = append(results, OpportunityResult{
			Query:             query,
			Page:              page,
			Position:          e.row.Position,
			CTR:               e.row.CTR,
			Bucket:            e.bucket,
			CategoryMedianCTR: median,
			CTRGap:            median - e.row.CTR,
		})
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].CTRGap != results[j].CTRGap {
			return results[i].CTRGap > results[j].CTRGap
		}
		if results[i].Page != results[j].Page {
			return results[i].Page < results[j].Page
		}
		return results[i].Query < results[j].Query
	})

	return results
}
