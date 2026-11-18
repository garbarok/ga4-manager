package gsc

import (
	"errors"
	"testing"
	"time"
)

type dateFake struct {
	rows  []SearchAnalyticsRow
	err   error
	query *SearchAnalyticsQuery
}

func (f *dateFake) QuerySearchAnalytics(q *SearchAnalyticsQuery) (*SearchAnalyticsReport, error) {
	f.query = q
	if f.err != nil {
		return nil, f.err
	}
	return &SearchAnalyticsReport{Rows: f.rows, QuotaUsed: 7}, nil
}

func TestDataThrough_LatestDateIgnoringNonDates(t *testing.T) {
	f := &dateFake{rows: []SearchAnalyticsRow{
		{Keys: []string{"2026-11-13"}}, {Keys: []string{"2026-11-15"}}, {Keys: []string{"https://example.com/"}}, {Keys: nil},
	}}
	got, quota, err := DataThrough(f, "sc-domain:example.com", time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC))
	if err != nil || got != "2026-11-15" || quota != 7 {
		t.Fatalf("got %q quota %d err %v", got, quota, err)
	}
	if f.query.Dimensions[0] != "date" || f.query.StartDate != "2026-11-04" || f.query.EndDate != "2026-11-18" || f.query.DataState != "final" {
		t.Fatalf("query = %+v", f.query)
	}
}

func TestDataThrough_ErrorAndEmpty(t *testing.T) {
	if _, _, err := DataThrough(&dateFake{err: errors.New("boom")}, "s", time.Now()); err == nil {
		t.Fatal("want error")
	}
	if got, _, _ := DataThrough(&dateFake{}, "s", time.Now()); got != "" {
		t.Fatalf("empty rows → %q", got)
	}
}
