package diagnostics

import (
	"math"
	"reflect"
	"testing"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

func ctrResultsApproxEqual(got, want []CTRAnomalyResult) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i].Query != want[i].Query || got[i].Page != want[i].Page {
			return false
		}
		if math.Abs(got[i].PositionDelta-want[i].PositionDelta) > 1e-9 {
			return false
		}
		if math.Abs(got[i].CTRDelta-want[i].CTRDelta) > 1e-9 {
			return false
		}
		if !reflect.DeepEqual(got[i].Pair, want[i].Pair) {
			return false
		}
	}
	return true
}

func TestCTRAnomaly(t *testing.T) {
	tests := []struct {
		name  string
		pairs []RowPair
		want  []CTRAnomalyResult
	}{
		{
			name:  "empty input returns empty result",
			pairs: nil,
			want:  []CTRAnomalyResult{},
		},
		{
			name: "position delta at boundary 1.0 is excluded by strict less-than",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 35, 1000, 0.035, 6.0),
					Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
				},
			},
			want: []CTRAnomalyResult{},
		},
		{
			name: "ctr delta just under magnitude threshold not classified",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 71, 1000, 0.071, 5.5),
					Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
				},
			},
			want: []CTRAnomalyResult{},
		},
		{
			name: "clears both bounds: position delta inside, ctr delta at threshold",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 70, 1000, 0.070, 5.5),
					Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
				},
			},
			want: []CTRAnomalyResult{
				{
					Query:         "widgets",
					Page:          "https://example.com/a",
					PositionDelta: 0.5,
					CTRDelta:      -0.30,
					Pair: RowPair{
						Current: pairRow("widgets", "https://example.com/a", 70, 1000, 0.070, 5.5),
						Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
					},
				},
			},
		},
		{
			name: "negative position delta inside bound also classified (page improved rank slightly but ctr cratered)",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 30, 1000, 0.030, 4.5),
					Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
				},
			},
			want: []CTRAnomalyResult{
				{
					Query:         "widgets",
					Page:          "https://example.com/a",
					PositionDelta: -0.5,
					CTRDelta:      -0.70,
					Pair: RowPair{
						Current: pairRow("widgets", "https://example.com/a", 30, 1000, 0.030, 4.5),
						Prior:   pairRow("widgets", "https://example.com/a", 100, 1000, 0.100, 5.0),
					},
				},
			},
		},
		{
			name: "prior ctr zero excluded",
			pairs: []RowPair{
				{
					Current: pairRow("widgets", "https://example.com/a", 0, 1000, 0.0, 5.0),
					Prior:   pairRow("widgets", "https://example.com/a", 0, 1000, 0.0, 5.0),
				},
			},
			want: []CTRAnomalyResult{},
		},
		{
			name: "ordering by ctr delta ascending then query then page",
			pairs: []RowPair{
				{
					Current: pairRow("b-mild", "https://example.com/p", 65, 1000, 0.065, 5.5),
					Prior:   pairRow("b-mild", "https://example.com/p", 100, 1000, 0.100, 5.0),
				},
				{
					Current: pairRow("a-severe", "https://example.com/p", 20, 1000, 0.020, 5.5),
					Prior:   pairRow("a-severe", "https://example.com/p", 100, 1000, 0.100, 5.0),
				},
				{
					Current: pairRow("a-tied", "https://example.com/q", 70, 1000, 0.070, 5.5),
					Prior:   pairRow("a-tied", "https://example.com/q", 100, 1000, 0.100, 5.0),
				},
				{
					Current: pairRow("a-tied", "https://example.com/p", 70, 1000, 0.070, 5.5),
					Prior:   pairRow("a-tied", "https://example.com/p", 100, 1000, 0.100, 5.0),
				},
			},
			want: []CTRAnomalyResult{
				{
					Query:         "a-severe",
					Page:          "https://example.com/p",
					PositionDelta: 0.5,
					CTRDelta:      -0.80,
					Pair: RowPair{
						Current: pairRow("a-severe", "https://example.com/p", 20, 1000, 0.020, 5.5),
						Prior:   pairRow("a-severe", "https://example.com/p", 100, 1000, 0.100, 5.0),
					},
				},
				{
					Query:         "b-mild",
					Page:          "https://example.com/p",
					PositionDelta: 0.5,
					CTRDelta:      -0.35,
					Pair: RowPair{
						Current: pairRow("b-mild", "https://example.com/p", 65, 1000, 0.065, 5.5),
						Prior:   pairRow("b-mild", "https://example.com/p", 100, 1000, 0.100, 5.0),
					},
				},
				{
					Query:         "a-tied",
					Page:          "https://example.com/p",
					PositionDelta: 0.5,
					CTRDelta:      -0.30,
					Pair: RowPair{
						Current: pairRow("a-tied", "https://example.com/p", 70, 1000, 0.070, 5.5),
						Prior:   pairRow("a-tied", "https://example.com/p", 100, 1000, 0.100, 5.0),
					},
				},
				{
					Query:         "a-tied",
					Page:          "https://example.com/q",
					PositionDelta: 0.5,
					CTRDelta:      -0.30,
					Pair: RowPair{
						Current: pairRow("a-tied", "https://example.com/q", 70, 1000, 0.070, 5.5),
						Prior:   pairRow("a-tied", "https://example.com/q", 100, 1000, 0.100, 5.0),
					},
				},
			},
		},
		{
			name: "wrong key arity skipped",
			pairs: []RowPair{
				{
					Current: gsc.SearchAnalyticsRow{Keys: []string{"only"}, CTR: 0.01, Position: 5.0},
					Prior:   gsc.SearchAnalyticsRow{Keys: []string{"only"}, CTR: 0.10, Position: 5.0},
				},
			},
			want: []CTRAnomalyResult{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CTRAnomaly(tt.pairs)
			if !ctrResultsApproxEqual(got, tt.want) {
				t.Fatalf("CTRAnomaly() mismatch\n got:  %#v\n want: %#v", got, tt.want)
			}
		})
	}
}
