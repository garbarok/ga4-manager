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
	Clicks            int64
	Impressions       int64
	CTR               float64
	Bucket            int
	CategoryMedianCTR float64
	// MedianSource reports where CategoryMedianCTR came from: "site" when at
	// least two same-site rows shared the bucket, or "baseline" when the
	// industry baseline curve was used as a fallback. Small sites often
	// have single-row buckets, so the baseline keeps the predicate useful
	// before the site has enough peers to compute its own medians.
	MedianSource string
	// CTRGap is CategoryMedianCTR − CTR — how far below the bucket median the
	// row sits as a ratio. Always > 0 for a qualifying row.
	CTRGap float64
	// PotentialClicks is the additional clicks the page would receive over
	// the same impression window if it converted at the bucket median CTR
	// instead of its current CTR. Computed as max(0, round(impressions *
	// (median - ctr))). This is the headline number for prioritising
	// optimisation work: "how many monthly clicks are we leaving on the
	// table for this query".
	PotentialClicks int64
}

// Median-source labels surfaced in OpportunityResult.MedianSource.
const (
	MedianSourceSite     = "site"
	MedianSourceBaseline = "baseline"
)

// baselineCTRByBucket is a published industry-average position-CTR curve,
// rounded to four decimal places. Used when the site itself has too few
// rows in a position bucket to compute its own median. The values are the
// rough centre of multiple public datasets (Advanced Web Ranking,
// Backlinko, Sistrix 2023-2024 averages) — they are NOT vertical-specific,
// but they buy a defensible "expected CTR for this position" floor that
// lets the opportunity predicate work on small sites where peer data is
// sparse. Operators with enough traffic get the site median instead.
var baselineCTRByBucket = map[int]float64{
	5:  0.065,
	6:  0.054,
	7:  0.045,
	8:  0.040,
	9:  0.035,
	10: 0.030,
	11: 0.025,
	12: 0.020,
	13: 0.018,
	14: 0.015,
	15: 0.013,
	16: 0.010,
	17: 0.010,
	18: 0.010,
	19: 0.010,
	20: 0.010,
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
// Results are ordered by PotentialClicks descending — the absolute number
// of monthly clicks the page would gain if it converted at the bucket
// median CTR — with CTRGap descending, Page ascending, and Query ascending
// as successive tie-breaks. The ordering is deliberate: the Operator
// (or an LLM consumer) acts on the biggest revenue win first, not on the
// largest relative gap.
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

	// Compute per-site bucket medians where we have enough peers, and label
	// each bucket with the median source. Single-row buckets fall back to
	// the published baseline curve so the predicate still finds opportunities
	// on small sites.
	type bucketMedian struct {
		ctr    float64
		source string
	}
	medians := make(map[int]bucketMedian, len(buckets))
	for bucket, ctrs := range buckets {
		if len(ctrs) >= 2 {
			sorted := append([]float64(nil), ctrs...)
			sort.Float64s(sorted)
			n := len(sorted)
			var m float64
			if n%2 == 1 {
				m = sorted[n/2]
			} else {
				m = (sorted[n/2-1] + sorted[n/2]) / 2.0
			}
			medians[bucket] = bucketMedian{ctr: m, source: MedianSourceSite}
			continue
		}
		if baseline, ok := baselineCTRByBucket[bucket]; ok {
			medians[bucket] = bucketMedian{ctr: baseline, source: MedianSourceBaseline}
		}
	}

	results := make([]OpportunityResult, 0)
	for _, e := range eligible {
		median, ok := medians[e.bucket]
		if !ok {
			continue
		}
		if e.row.CTR >= median.ctr {
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

		ctrGap := median.ctr - e.row.CTR
		potential := int64(math.Round(float64(e.row.Impressions) * ctrGap))
		if potential < 0 {
			potential = 0
		}
		results = append(results, OpportunityResult{
			Query:             query,
			Page:              page,
			Position:          e.row.Position,
			Clicks:            e.row.Clicks,
			Impressions:       e.row.Impressions,
			CTR:               e.row.CTR,
			Bucket:            e.bucket,
			CategoryMedianCTR: median.ctr,
			MedianSource:      median.source,
			CTRGap:            ctrGap,
			PotentialClicks:   potential,
		})
	}

	// Sort by absolute clicks left on the table descending — that is the
	// metric an Operator can act on directly ("rewriting this title would
	// recover ~N clicks/month"). CTRGap is the relative measure and is kept
	// as a secondary tie-break for deterministic ordering at equal
	// PotentialClicks.
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].PotentialClicks != results[j].PotentialClicks {
			return results[i].PotentialClicks > results[j].PotentialClicks
		}
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
