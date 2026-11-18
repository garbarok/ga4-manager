package gsc

// RowFilter narrows Search Analytics rows by average position and impressions.
// The GSC API cannot filter by position, so the filter runs over the top rows
// the API returned (ordered by clicks): rows beyond the row limit are never
// considered. Nil bounds are not applied.
type RowFilter struct {
	MinPosition    *float64 `json:"min_position,omitempty"`
	MaxPosition    *float64 `json:"max_position,omitempty"`
	MinImpressions *int64   `json:"min_impressions,omitempty"`
}

// RowFilterResult reports what the filter did, so a caller can tell an empty
// result from rows that were never fetched.
type RowFilterResult struct {
	RowFilter
	RowsConsidered int    `json:"rows_considered"`
	RowsKept       int    `json:"rows_kept"`
	Note           string `json:"note"`
}

// Active reports whether any bound is set.
func (f RowFilter) Active() bool {
	return f.MinPosition != nil || f.MaxPosition != nil || f.MinImpressions != nil
}

// Keep reports whether row passes every set bound.
func (f RowFilter) Keep(row SearchAnalyticsRow) bool {
	if f.MinPosition != nil && row.Position < *f.MinPosition {
		return false
	}
	if f.MaxPosition != nil && row.Position > *f.MaxPosition {
		return false
	}
	if f.MinImpressions != nil && row.Impressions < *f.MinImpressions {
		return false
	}
	return true
}

// Apply filters report.Rows in place, recomputes TotalRows and Aggregates over
// the rows kept, and returns what was considered and kept.
func (f RowFilter) Apply(report *SearchAnalyticsReport) RowFilterResult {
	res := RowFilterResult{RowFilter: f, RowsConsidered: len(report.Rows)}
	kept := make([]SearchAnalyticsRow, 0, len(report.Rows))
	for _, r := range report.Rows {
		if f.Keep(r) {
			kept = append(kept, r)
		}
	}
	report.Rows = kept
	report.TotalRows = len(kept)
	report.Aggregates = aggregate(kept)
	res.RowsKept = len(kept)
	res.Note = "Applied after fetching: only the top rows within --limit were considered (GSC cannot filter by position). Aggregates cover the kept rows. Raise --limit to widen the pool."
	return res
}

func aggregate(rows []SearchAnalyticsRow) SearchAnalyticsAggregate {
	if len(rows) == 0 {
		return SearchAnalyticsAggregate{}
	}
	var a SearchAnalyticsAggregate
	var ctr, pos float64
	for _, r := range rows {
		a.TotalClicks += r.Clicks
		a.TotalImpressions += r.Impressions
		ctr += r.CTR
		pos += r.Position
	}
	a.AverageCTR = ctr / float64(len(rows))
	a.AveragePosition = pos / float64(len(rows))
	return a
}
