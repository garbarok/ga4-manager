package diagnostics

import (
	"reflect"
	"testing"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

func row(query, page string, impressions int64) gsc.SearchAnalyticsRow {
	return gsc.SearchAnalyticsRow{
		Keys:        []string{query, page},
		Impressions: impressions,
	}
}

func TestCannibalisation(t *testing.T) {
	tests := []struct {
		name           string
		rows           []gsc.SearchAnalyticsRow
		minImpressions int64
		want           []CannibalisationResult
	}{
		{
			name:           "empty input returns empty result",
			rows:           nil,
			minImpressions: 10,
			want:           []CannibalisationResult{},
		},
		{
			name: "single page per query is never cannibalisation",
			rows: []gsc.SearchAnalyticsRow{
				row("widgets", "https://example.com/a", 100),
				row("gadgets", "https://example.com/b", 200),
			},
			minImpressions: 10,
			want:           []CannibalisationResult{},
		},
		{
			name: "two pages at the threshold qualify",
			rows: []gsc.SearchAnalyticsRow{
				row("widgets", "https://example.com/a", 10),
				row("widgets", "https://example.com/b", 10),
			},
			minImpressions: 10,
			want: []CannibalisationResult{
				{
					Query: "widgets",
					Pages: []PageImpressions{
						{Page: "https://example.com/a", Impressions: 10},
						{Page: "https://example.com/b", Impressions: 10},
					},
					TotalImpressions:   20,
					CanonicalCandidate: "https://example.com/a",
				},
			},
		},
		{
			name: "page below threshold disqualifies pair",
			rows: []gsc.SearchAnalyticsRow{
				row("widgets", "https://example.com/a", 10),
				row("widgets", "https://example.com/b", 9),
			},
			minImpressions: 10,
			want:           []CannibalisationResult{},
		},
		{
			name: "more than two qualifying pages all kept and ranked",
			rows: []gsc.SearchAnalyticsRow{
				row("widgets", "https://example.com/a", 30),
				row("widgets", "https://example.com/b", 50),
				row("widgets", "https://example.com/c", 20),
				row("widgets", "https://example.com/d", 5),
			},
			minImpressions: 10,
			want: []CannibalisationResult{
				{
					Query: "widgets",
					Pages: []PageImpressions{
						{Page: "https://example.com/b", Impressions: 50},
						{Page: "https://example.com/a", Impressions: 30},
						{Page: "https://example.com/c", Impressions: 20},
					},
					TotalImpressions:   100,
					CanonicalCandidate: "https://example.com/b",
				},
			},
		},
		{
			name: "results sorted by total impressions descending then query ascending",
			rows: []gsc.SearchAnalyticsRow{
				row("widgets", "https://example.com/a", 20),
				row("widgets", "https://example.com/b", 25),
				row("gadgets", "https://example.com/c", 100),
				row("gadgets", "https://example.com/d", 100),
				row("sprockets", "https://example.com/e", 15),
				row("sprockets", "https://example.com/f", 30),
			},
			minImpressions: 10,
			want: []CannibalisationResult{
				{
					Query: "gadgets",
					Pages: []PageImpressions{
						{Page: "https://example.com/c", Impressions: 100},
						{Page: "https://example.com/d", Impressions: 100},
					},
					TotalImpressions:   200,
					CanonicalCandidate: "https://example.com/c",
				},
				{
					Query: "sprockets",
					Pages: []PageImpressions{
						{Page: "https://example.com/f", Impressions: 30},
						{Page: "https://example.com/e", Impressions: 15},
					},
					TotalImpressions:   45,
					CanonicalCandidate: "https://example.com/f",
				},
				{
					Query: "widgets",
					Pages: []PageImpressions{
						{Page: "https://example.com/b", Impressions: 25},
						{Page: "https://example.com/a", Impressions: 20},
					},
					TotalImpressions:   45,
					CanonicalCandidate: "https://example.com/b",
				},
			},
		},
		{
			name: "rows aggregate when same query+page repeats",
			rows: []gsc.SearchAnalyticsRow{
				row("widgets", "https://example.com/a", 6),
				row("widgets", "https://example.com/a", 6),
				row("widgets", "https://example.com/b", 10),
			},
			minImpressions: 10,
			want: []CannibalisationResult{
				{
					Query: "widgets",
					Pages: []PageImpressions{
						{Page: "https://example.com/a", Impressions: 12},
						{Page: "https://example.com/b", Impressions: 10},
					},
					TotalImpressions:   22,
					CanonicalCandidate: "https://example.com/a",
				},
			},
		},
		{
			name: "rows with wrong key arity are skipped",
			rows: []gsc.SearchAnalyticsRow{
				{Keys: []string{"only-one"}, Impressions: 100},
				row("widgets", "https://example.com/a", 10),
				row("widgets", "https://example.com/b", 10),
			},
			minImpressions: 10,
			want: []CannibalisationResult{
				{
					Query: "widgets",
					Pages: []PageImpressions{
						{Page: "https://example.com/a", Impressions: 10},
						{Page: "https://example.com/b", Impressions: 10},
					},
					TotalImpressions:   20,
					CanonicalCandidate: "https://example.com/a",
				},
			},
		},
		{
			name: "custom threshold below default is honoured",
			rows: []gsc.SearchAnalyticsRow{
				row("widgets", "https://example.com/a", 5),
				row("widgets", "https://example.com/b", 5),
			},
			minImpressions: 5,
			want: []CannibalisationResult{
				{
					Query: "widgets",
					Pages: []PageImpressions{
						{Page: "https://example.com/a", Impressions: 5},
						{Page: "https://example.com/b", Impressions: 5},
					},
					TotalImpressions:   10,
					CanonicalCandidate: "https://example.com/a",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Cannibalisation(tt.rows, tt.minImpressions)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("Cannibalisation() mismatch\n got:  %#v\n want: %#v", got, tt.want)
			}
		})
	}
}

func TestCannibalisation_ZeroThresholdFallsBackToDefault(t *testing.T) {
	rows := []gsc.SearchAnalyticsRow{
		row("widgets", "https://example.com/a", 9),
		row("widgets", "https://example.com/b", 9),
	}
	got := Cannibalisation(rows, 0)
	if len(got) != 0 {
		t.Fatalf("expected no results at default threshold of %d, got %d", DefaultMinImpressions, len(got))
	}
}
