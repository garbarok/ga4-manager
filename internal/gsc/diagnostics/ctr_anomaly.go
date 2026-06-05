package diagnostics

import (
	"math"
	"sort"
)

// CTRAnomalyResult is one (query, page) pair that satisfies the CTR-anomaly
// predicate.
//
// PositionDelta is current.Position − prior.Position. CTRDelta is the relative
// change in CTR as a ratio: (current.CTR − prior.CTR) / prior.CTR.
type CTRAnomalyResult struct {
	Query         string
	Page          string
	PositionDelta float64
	CTRDelta      float64
}

// CTRAnomaly classifies row pairs under the CTR-anomaly predicate.
//
// Predicate (see CONTEXT.md "SEO Diagnostics"):
//
//	ctr_anomaly := |position_delta| < 1.0 AND ctr_delta <= -30%
//
// The position bound is strict less-than: a pair at exactly |position_delta|
// = 1.0 belongs in the decay/recovery space, not here. Pairs whose Prior.CTR
// is zero are excluded: the relative CTR delta is undefined without a prior
// baseline. Pairs whose Keys are not [query, page] are skipped.
//
// Results are ordered by CTRDelta ascending (most negative — i.e. worst drop —
// first), with a deterministic tie-break by Query ascending then Page
// ascending. CTRDelta is chosen as the primary sort because it is the magnitude
// of the anomaly itself; absolute click loss is not part of the predicate.
func CTRAnomaly(pairs []RowPair) []CTRAnomalyResult {
	results := make([]CTRAnomalyResult, 0)

	for _, pair := range pairs {
		if len(pair.Current.Keys) != 2 || len(pair.Prior.Keys) != 2 {
			continue
		}
		query, page := pair.Current.Keys[0], pair.Current.Keys[1]
		if query == "" || page == "" {
			continue
		}
		if pair.Prior.CTR == 0 {
			continue
		}

		positionDelta := pair.Current.Position - pair.Prior.Position
		ctrDelta := (pair.Current.CTR - pair.Prior.CTR) / pair.Prior.CTR

		if math.Abs(positionDelta) >= 1.0 || ctrDelta > -0.30 {
			continue
		}

		results = append(results, CTRAnomalyResult{
			Query:         query,
			Page:          page,
			PositionDelta: positionDelta,
			CTRDelta:      ctrDelta,
		})
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].CTRDelta != results[j].CTRDelta {
			return results[i].CTRDelta < results[j].CTRDelta
		}
		if results[i].Query != results[j].Query {
			return results[i].Query < results[j].Query
		}
		return results[i].Page < results[j].Page
	})

	return results
}
