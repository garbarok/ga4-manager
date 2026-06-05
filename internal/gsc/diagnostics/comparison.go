package diagnostics

import "github.com/garbarok/ga4-manager/internal/gsc"

// RowPair pairs a current-window search-analytics row with its prior-window
// counterpart for the same (query, page). Used by predicates that compare two
// windows (Decay, CTR anomaly). See CONTEXT.md "SEO Diagnostics" for the
// canonical definitions.
type RowPair struct {
	Current gsc.SearchAnalyticsRow
	Prior   gsc.SearchAnalyticsRow
}
