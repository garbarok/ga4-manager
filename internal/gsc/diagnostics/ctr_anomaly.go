package diagnostics

import (
	"math"
	"sort"
)

// CTRAnomalyResult is one (query, page) pair that satisfies the CTR-anomaly
// predicate — its position held but its CTR collapsed.
//
// PositionDelta is current.Position − prior.Position. CTRDelta is the relative
// change in CTR as a ratio: (current.CTR − prior.CTR) / prior.CTR.
// ClicksLost is prior.Clicks − current.Clicks, clamped to ≥0 — the
// absolute revenue impact of the anomaly, useful for ranking results by
// how much the Operator can recover by fixing the snippet.
type CTRAnomalyResult struct {
	Query              string
	Page               string
	PositionCurrent    float64
	PositionPrior      float64
	PositionDelta      float64
	CTRCurrent         float64
	CTRPrior           float64
	CTRDelta           float64
	ClicksCurrent      int64
	ClicksPrior        int64
	ClicksLost         int64
	ImpressionsCurrent int64
	ImpressionsPrior   int64
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

		clicksLost := pair.Prior.Clicks - pair.Current.Clicks
		if clicksLost < 0 {
			clicksLost = 0
		}
		results = append(results, CTRAnomalyResult{
			Query:              query,
			Page:               page,
			PositionCurrent:    pair.Current.Position,
			PositionPrior:      pair.Prior.Position,
			PositionDelta:      positionDelta,
			CTRCurrent:         pair.Current.CTR,
			CTRPrior:           pair.Prior.CTR,
			CTRDelta:           ctrDelta,
			ClicksCurrent:      pair.Current.Clicks,
			ClicksPrior:        pair.Prior.Clicks,
			ClicksLost:         clicksLost,
			ImpressionsCurrent: pair.Current.Impressions,
			ImpressionsPrior:   pair.Prior.Impressions,
		})
	}

	// Sort by absolute clicks lost descending — the actionable signal an
	// Operator (or an LLM rewriter) wants to act on first. CTRDelta is a
	// useful secondary tie-break for results at equal clicks lost.
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].ClicksLost != results[j].ClicksLost {
			return results[i].ClicksLost > results[j].ClicksLost
		}
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
