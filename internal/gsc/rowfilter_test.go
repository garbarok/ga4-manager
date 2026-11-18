package gsc

import "testing"

func TestRowFilterApply(t *testing.T) {
	minP, maxP := 4.0, 20.0
	minI := int64(50)
	report := &SearchAnalyticsReport{Rows: []SearchAnalyticsRow{
		{Keys: []string{"a"}, Position: 2, Impressions: 500, Clicks: 50, CTR: 0.1},
		{Keys: []string{"b"}, Position: 6.5, Impressions: 300, Clicks: 9, CTR: 0.03},
		{Keys: []string{"c"}, Position: 12, Impressions: 20, Clicks: 0},
		{Keys: []string{"d"}, Position: 20, Impressions: 80, Clicks: 1, CTR: 0.0125},
		{Keys: []string{"e"}, Position: 31, Impressions: 900},
	}, TotalRows: 5}
	f := RowFilter{MinPosition: &minP, MaxPosition: &maxP, MinImpressions: &minI}
	if !f.Active() || (RowFilter{}).Active() {
		t.Fatal("Active()")
	}
	res := f.Apply(report)
	if res.RowsConsidered != 5 || res.RowsKept != 2 || report.TotalRows != 2 {
		t.Fatalf("res = %+v", res)
	}
	if report.Rows[0].Keys[0] != "b" || report.Rows[1].Keys[0] != "d" {
		t.Fatalf("rows = %+v", report.Rows)
	}
	if report.Aggregates.TotalClicks != 10 || report.Aggregates.TotalImpressions != 380 || report.Aggregates.AveragePosition != 13.25 {
		t.Fatalf("aggregates = %+v", report.Aggregates)
	}
}
