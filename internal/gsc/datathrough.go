package gsc

import "time"

// DataThrough reports the last date (YYYY-MM-DD) for which Search Console has
// final data for site, so callers can tell a "drop" from data that has not
// landed yet. It asks for the date dimension over the last 14 days (one
// quota unit) and returns the latest date row. Rows whose key is not a date
// are ignored, so a fake or unexpected response yields "" rather than a bogus
// date. quotaUsed is the client's cumulative quota after the call.
func DataThrough(api SearchAPI, site string, now time.Time) (date string, quotaUsed int, err error) {
	end := now.UTC()
	start := end.AddDate(0, 0, -14)
	report, err := api.QuerySearchAnalytics(&SearchAnalyticsQuery{
		SiteURL:    site,
		StartDate:  start.Format("2006-01-02"),
		EndDate:    end.Format("2006-01-02"),
		Dimensions: []string{"date"},
		RowLimit:   30,
		DataState:  "final",
	})
	if err != nil {
		return "", 0, err
	}
	for _, row := range report.Rows {
		if len(row.Keys) == 0 {
			continue
		}
		k := row.Keys[0]
		if _, perr := time.Parse("2006-01-02", k); perr != nil {
			continue
		}
		if k > date {
			date = k
		}
	}
	return date, report.QuotaUsed, nil
}
