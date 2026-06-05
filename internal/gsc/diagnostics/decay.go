package diagnostics

import "sort"

// DecayResult is one (query, page) pair that satisfies the decay predicate.
//
// PositionDelta is current.Position − prior.Position (in GSC, a higher numeric
// position is worse, so a positive delta means the page slipped). ClicksDelta
// is the relative change in clicks as a ratio: (current − prior) / prior.
// ClicksLost is the absolute drop, kept non-negative for ordering convenience.
type DecayResult struct {
	Query         string
	Page          string
	PositionDelta float64
	ClicksDelta   float64
	ClicksLost    int64
	Pair          RowPair
}

// Decay classifies row pairs under the decay predicate.
//
// Predicate (see CONTEXT.md "SEO Diagnostics"):
//
//	decay := position_delta >= +1.0 AND clicks_delta <= -20%
//
// Pairs whose Prior.Clicks is zero are excluded: the relative clicks delta is
// undefined when there is no prior baseline. Pairs whose Current or Prior Keys
// are not [query, page] are skipped.
//
// Results are ordered by absolute clicks lost descending, with a deterministic
// tie-break by Query ascending then Page ascending.
func Decay(pairs []RowPair) []DecayResult {
	results := make([]DecayResult, 0)

	for _, pair := range pairs {
		if len(pair.Current.Keys) != 2 || len(pair.Prior.Keys) != 2 {
			continue
		}
		query, page := pair.Current.Keys[0], pair.Current.Keys[1]
		if query == "" || page == "" {
			continue
		}
		if pair.Prior.Clicks == 0 {
			continue
		}

		positionDelta := pair.Current.Position - pair.Prior.Position
		clicksDelta := float64(pair.Current.Clicks-pair.Prior.Clicks) / float64(pair.Prior.Clicks)

		if positionDelta < 1.0 || clicksDelta > -0.20 {
			continue
		}

		clicksLost := pair.Prior.Clicks - pair.Current.Clicks
		if clicksLost < 0 {
			clicksLost = -clicksLost
		}

		results = append(results, DecayResult{
			Query:         query,
			Page:          page,
			PositionDelta: positionDelta,
			ClicksDelta:   clicksDelta,
			ClicksLost:    clicksLost,
			Pair:          pair,
		})
	}

	sort.SliceStable(results, func(i, j int) bool {
		if results[i].ClicksLost != results[j].ClicksLost {
			return results[i].ClicksLost > results[j].ClicksLost
		}
		if results[i].Query != results[j].Query {
			return results[i].Query < results[j].Query
		}
		return results[i].Page < results[j].Page
	})

	return results
}
