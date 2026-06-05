package diagnostics

import (
	"math"
	"reflect"
	"testing"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

func opportunityResultsApproxEqual(got, want []OpportunityResult) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i].Query != want[i].Query || got[i].Page != want[i].Page {
			return false
		}
		if got[i].Bucket != want[i].Bucket {
			return false
		}
		if math.Abs(got[i].Position-want[i].Position) > 1e-9 ||
			math.Abs(got[i].CTR-want[i].CTR) > 1e-9 ||
			math.Abs(got[i].CategoryMedianCTR-want[i].CategoryMedianCTR) > 1e-9 ||
			math.Abs(got[i].CTRGap-want[i].CTRGap) > 1e-9 {
			return false
		}
		if !reflect.DeepEqual(got[i].Row, want[i].Row) {
			return false
		}
	}
	return true
}

func oppRow(query, page string, position, ctr float64, impressions int64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{
		Keys:        []string{query, page},
		Impressions: impressions,
		CTR:         ctr,
		Position:    position,
	}
}

func TestOpportunity(t *testing.T) {
	tests := []struct {
		name string
		rows []gsc.SearchAnalyticsRow
		want []OpportunityResult
	}{
		{
			name: "empty input returns empty result",
			rows: nil,
			want: []OpportunityResult{},
		},
		{
			name: "position outside [5, 20] excluded",
			rows: []gsc.SearchAnalyticsRow{
				oppRow("q1", "https://example.com/a", 4.4, 0.01, 1000),
				oppRow("q1", "https://example.com/b", 4.4, 0.10, 1000),
				oppRow("q2", "https://example.com/c", 20.6, 0.01, 1000),
				oppRow("q2", "https://example.com/d", 20.6, 0.10, 1000),
			},
			want: []OpportunityResult{},
		},
		{
			name: "single-row bucket excluded",
			rows: []gsc.SearchAnalyticsRow{
				oppRow("q1", "https://example.com/a", 10.0, 0.01, 1000),
			},
			want: []OpportunityResult{},
		},
		{
			name: "all-equal-ctr bucket yields no opportunities",
			rows: []gsc.SearchAnalyticsRow{
				oppRow("q1", "https://example.com/a", 10.0, 0.05, 1000),
				oppRow("q1", "https://example.com/b", 10.0, 0.05, 1000),
				oppRow("q1", "https://example.com/c", 10.0, 0.05, 1000),
			},
			want: []OpportunityResult{},
		},
		{
			name: "rounding boundary: position 4.5 rounds up to bucket 5 and qualifies",
			rows: []gsc.SearchAnalyticsRow{
				oppRow("q1", "https://example.com/low", 4.5, 0.01, 1000),
				oppRow("q1", "https://example.com/high", 4.5, 0.10, 1000),
			},
			want: []OpportunityResult{
				{
					Query:             "q1",
					Page:              "https://example.com/low",
					Position:          4.5,
					CTR:               0.01,
					Bucket:            5,
					CategoryMedianCTR: 0.055,
					CTRGap:            0.045,
					Row:               oppRow("q1", "https://example.com/low", 4.5, 0.01, 1000),
				},
			},
		},
		{
			name: "rounding boundary: position 4.4 rounds to bucket 4 and is excluded",
			rows: []gsc.SearchAnalyticsRow{
				oppRow("q1", "https://example.com/low", 4.4, 0.01, 1000),
				oppRow("q1", "https://example.com/high", 4.4, 0.10, 1000),
			},
			want: []OpportunityResult{},
		},
		{
			name: "odd bucket size median is middle value",
			rows: []gsc.SearchAnalyticsRow{
				oppRow("q", "https://example.com/a", 10.0, 0.02, 1000),
				oppRow("q", "https://example.com/b", 10.0, 0.05, 1000),
				oppRow("q", "https://example.com/c", 10.0, 0.20, 1000),
			},
			want: []OpportunityResult{
				{
					Query:             "q",
					Page:              "https://example.com/a",
					Position:          10.0,
					CTR:               0.02,
					Bucket:            10,
					CategoryMedianCTR: 0.05,
					CTRGap:            0.05 - 0.02,
					Row:               oppRow("q", "https://example.com/a", 10.0, 0.02, 1000),
				},
			},
		},
		{
			name: "even bucket size median averages middle two",
			rows: []gsc.SearchAnalyticsRow{
				oppRow("q", "https://example.com/a", 8.0, 0.01, 1000),
				oppRow("q", "https://example.com/b", 8.0, 0.03, 1000),
				oppRow("q", "https://example.com/c", 8.0, 0.05, 1000),
				oppRow("q", "https://example.com/d", 8.0, 0.07, 1000),
			},
			want: []OpportunityResult{
				{
					Query:             "q",
					Page:              "https://example.com/a",
					Position:          8.0,
					CTR:               0.01,
					Bucket:            8,
					CategoryMedianCTR: 0.04,
					CTRGap:            0.03,
					Row:               oppRow("q", "https://example.com/a", 8.0, 0.01, 1000),
				},
				{
					Query:             "q",
					Page:              "https://example.com/b",
					Position:          8.0,
					CTR:               0.03,
					Bucket:            8,
					CategoryMedianCTR: 0.04,
					CTRGap:            0.01,
					Row:               oppRow("q", "https://example.com/b", 8.0, 0.03, 1000),
				},
			},
		},
		{
			name: "results sorted by ctr gap descending then page then query",
			rows: []gsc.SearchAnalyticsRow{
				oppRow("q-x", "https://example.com/p1", 10.0, 0.01, 1000),
				oppRow("q-y", "https://example.com/p1", 10.0, 0.02, 1000),
				oppRow("q-z", "https://example.com/p2", 10.0, 0.03, 1000),
				oppRow("q-anchor", "https://example.com/p3", 10.0, 0.30, 1000),
			},
			want: []OpportunityResult{
				{
					Query:             "q-x",
					Page:              "https://example.com/p1",
					Position:          10.0,
					CTR:               0.01,
					Bucket:            10,
					CategoryMedianCTR: 0.025,
					CTRGap:            0.015,
					Row:               oppRow("q-x", "https://example.com/p1", 10.0, 0.01, 1000),
				},
				{
					Query:             "q-y",
					Page:              "https://example.com/p1",
					Position:          10.0,
					CTR:               0.02,
					Bucket:            10,
					CategoryMedianCTR: 0.025,
					CTRGap:            0.005,
					Row:               oppRow("q-y", "https://example.com/p1", 10.0, 0.02, 1000),
				},
			},
		},
		{
			name: "single-key row uses Keys[0] as page",
			rows: []gsc.SearchAnalyticsRow{
				{Keys: []string{"https://example.com/a"}, CTR: 0.01, Position: 10.0, Impressions: 1000},
				{Keys: []string{"https://example.com/b"}, CTR: 0.10, Position: 10.0, Impressions: 1000},
			},
			want: []OpportunityResult{
				{
					Query:             "",
					Page:              "https://example.com/a",
					Position:          10.0,
					CTR:               0.01,
					Bucket:            10,
					CategoryMedianCTR: 0.055,
					CTRGap:            0.045,
					Row:               gsc.SearchAnalyticsRow{Keys: []string{"https://example.com/a"}, CTR: 0.01, Position: 10.0, Impressions: 1000},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Opportunity(tt.rows)
			if !opportunityResultsApproxEqual(got, tt.want) {
				t.Fatalf("Opportunity() mismatch\n got:  %#v\n want: %#v", got, tt.want)
			}
		})
	}
}
