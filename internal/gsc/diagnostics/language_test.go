package diagnostics

import "testing"

func TestPageLocale(t *testing.T) {
	tests := []struct {
		page string
		want string
	}{
		{"https://example.com/en/blog/post/", "en"},
		{"/en/blog/post/", "en"},
		{"/blog/post/", ""},               // default-locale page (no prefix)
		{"https://example.com/", ""},      // home, default locale
		{"https://example.com/en/", "en"}, // localised home
		{"/pt-br/blog/x", "pt"},           // region-qualified → language sub-tag
		{"/products/widget", ""},          // non-locale first segment
		{"https://example.com/fr/about", "fr"},
	}
	for _, tt := range tests {
		if got := PageLocale(tt.page); got != tt.want {
			t.Errorf("PageLocale(%q) = %q, want %q", tt.page, got, tt.want)
		}
	}
}

func TestMarkCrossLanguage(t *testing.T) {
	tests := []struct {
		name  string
		pages []string
		want  bool
	}{
		{
			name:  "translation pair across locales is cross-language",
			pages: []string{"https://example.com/en/blog/intro/", "https://example.com/blog/intro-es/"},
			want:  true,
		},
		{
			name:  "two pages in the same default locale is NOT cross-language",
			pages: []string{"https://example.com/blog/a/", "https://example.com/blog/b/"},
			want:  false,
		},
		{
			name:  "two same-language pages plus one translation stays actionable",
			pages: []string{"https://example.com/blog/a/", "https://example.com/blog/b/", "https://example.com/en/blog/a/"},
			want:  false,
		},
		{
			name:  "two prefixed locales is cross-language",
			pages: []string{"https://example.com/en/x/", "https://example.com/fr/x/"},
			want:  true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := []CannibalisationResult{{Pages: toPageImpressions(tt.pages)}}
			MarkCrossLanguage(res)
			if res[0].CrossLanguage != tt.want {
				t.Errorf("CrossLanguage = %v, want %v", res[0].CrossLanguage, tt.want)
			}
		})
	}
}

func toPageImpressions(pages []string) []PageImpressions {
	out := make([]PageImpressions, 0, len(pages))
	for i, p := range pages {
		out = append(out, PageImpressions{Page: p, Impressions: int64(100 - i)})
	}
	return out
}
