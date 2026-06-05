package diagnostics

import (
	"math"
	"reflect"
	"testing"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

func decayResultsApproxEqual(got, want []DecayResult) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i].Query != want[i].Query || got[i].Page != want[i].Page {
			return false
		}
		if got[i].ClicksLost != want[i].ClicksLost {
			return false
		}
		if math.Abs(got[i].PositionDelta-want[i].PositionDelta) > 1e-9 ||
			math.Abs(got[i].ClicksDelta-want[i].ClicksDelta) > 1e-9 {
			return false
		}
		if !reflect.DeepEqual(got[i].Pair, want[i].Pair) {
			return false
		}
	}
	return true
}

func pairRow(query, page string, clicks int64, impressions int64, ctr, position float64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{
		Keys:        []string{query, page},
		Clicks:      clicks,
		Impressions: impressions,
		CTR:         ctr,
		Position:    position,
	}
}

func TestDecay(t *testing.T) {
	tests := []struct {
		name  string
		pairs []RowPair
		want  []DecayResult
	}{
		{
			name:  "empty input returns empty result",
			pairs: nil,
			want:  []DecayResult{},
		},
		{
			name: "position delta just under threshold is not decay",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 50, 1000, 0.05, 5.9),
					Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.10, 5.0),
				},
			},
			want: []DecayResult{},
		},
		{
			name: "clicks delta just under magnitude threshold is not decay",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 81, 1000, 0.081, 6.5),
					Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
				},
			},
			want: []DecayResult{},
		},
		{
			name: "exactly at thresholds qualifies",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 80, 1000, 0.080, 6.0),
					Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
				},
			},
			want: []DecayResult{
				{
					Query:         "widgets",
					Page:          "https://example.com/a",
					PositionDelta: 1.0,
					ClicksDelta:   -0.20,
					ClicksLost:    20,
					Pair: RowPair{
						Current: pairRow("widgets", "https://example.com/a", 80, 1000, 0.080, 6.0),
						Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
					},
				},
			},
		},
		{
			name: "prior clicks zero excluded",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 0, 1000, 0.0, 8.0),
					Prior:   pairRow("widgets", "https://example.com/a", 0, 1000, 0.0, 5.0),
				},
			},
			want: []DecayResult{},
		},
		{
			name: "results ordered by absolute clicks lost descending",
			pairs: []RowPair{
				{
					Current: pairRow("small", "https://example.com/s", 8, 100, 0.08, 7.0),
					Prior:   pairRow("small", "https://example.com/s", 10, 100, 0.10, 5.0),
				},
				{
					Current: pairRow("big", "https://example.com/b", 400, 5000, 0.08, 7.0),
					Prior:   pairRow("big", "https://example.com/b", 500, 5000, 0.10, 5.0),
				},
				{
					Current: pairRow("mid", "https://example.com/m", 40, 500, 0.08, 7.0),
					Prior:   pairRow("mid", "https://example.com/m", 50, 500, 0.10, 5.0),
				},
			},
			want: []DecayResult{
				{
					Query:         "big",
					Page:          "https://example.com/b",
					PositionDelta: 2.0,
					ClicksDelta:   -0.20,
					ClicksLost:    100,
					Pair: RowPair{
						Current: pairRow("big", "https://example.com/b", 400, 5000, 0.08, 7.0),
						Prior:   pairRow("big", "https://example.com/b", 500, 5000, 0.10, 5.0),
					},
				},
				{
					Query:         "mid",
					Page:          "https://example.com/m",
					PositionDelta: 2.0,
					ClicksDelta:   -0.20,
					ClicksLost:    10,
					Pair: RowPair{
						Current: pairRow("mid", "https://example.com/m", 40, 500, 0.08, 7.0),
						Prior:   pairRow("mid", "https://example.com/m", 50, 500, 0.10, 5.0),
					},
				},
				{
					Query:         "small",
					Page:          "https://example.com/s",
					PositionDelta: 2.0,
					ClicksDelta:   -0.20,
					ClicksLost:    2,
					Pair: RowPair{
						Current: pairRow("small", "https://example.com/s", 8, 100, 0.08, 7.0),
						Prior:   pairRow("small", "https://example.com/s", 10, 100, 0.10, 5.0),
					},
				},
			},
		},
		{
			name: "tie on clicks lost breaks by query then page",
			pairs: []RowPair{
				{
					Current: pairRow("b", "https://example.com/p2", 0, 1000, 0.0, 8.0),
					Prior:   pairRow("b", "https://example.com/p2", 10, 1000, 0.01, 5.0),
				},
				{
					Current: pairRow("a", "https://example.com/p2", 0, 1000, 0.0, 8.0),
					Prior:   pairRow("a", "https://example.com/p2", 10, 1000, 0.01, 5.0),
				},
				{
					Current: pairRow("a", "https://example.com/p1", 0, 1000, 0.0, 8.0),
					Prior:   pairRow("a", "https://example.com/p1", 10, 1000, 0.01, 5.0),
				},
			},
			want: []DecayResult{
				{
					Query:         "a",
					Page:          "https://example.com/p1",
					PositionDelta: 3.0,
					ClicksDelta:   -1.0,
					ClicksLost:    10,
					Pair: RowPair{
						Current: pairRow("a", "https://example.com/p1", 0, 1000, 0.0, 8.0),
						Prior:   pairRow("a", "https://example.com/p1", 10, 1000, 0.01, 5.0),
					},
				},
				{
					Query:         "a",
					Page:          "https://example.com/p2",
					PositionDelta: 3.0,
					ClicksDelta:   -1.0,
					ClicksLost:    10,
					Pair: RowPair{
						Current: pairRow("a", "https://example.com/p2", 0, 1000, 0.0, 8.0),
						Prior:   pairRow("a", "https://example.com/p2", 10, 1000, 0.01, 5.0),
					},
				},
				{
					Query:         "b",
					Page:          "https://example.com/p2",
					PositionDelta: 3.0,
					ClicksDelta:   -1.0,
					ClicksLost:    10,
					Pair: RowPair{
						Current: pairRow("b", "https://example.com/p2", 0, 1000, 0.0, 8.0),
						Prior:   pairRow("b", "https://example.com/p2", 10, 1000, 0.01, 5.0),
					},
				},
			},
		},
		{
			name: "wrong key arity skipped",
			pairs: []RowPair{
				{
					Current: gsc.SearchAnalyticsRow{Keys: []string{"only"}, Clicks: 10, Position: 8.0},
					Prior:   gsc.SearchAnalyticsRow{Keys: []string{"only"}, Clicks: 100, Position: 5.0},
				},
			},
			want: []DecayResult{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Decay(tt.pairs)
			if !decayResultsApproxEqual(got, tt.want) {
				t.Fatalf("Decay() mismatch\n got:  %#v\n want: %#v", got, tt.want)
			}
		})
	}
}
