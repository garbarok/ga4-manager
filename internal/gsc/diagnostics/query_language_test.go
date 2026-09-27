package diagnostics

import "testing"

func TestInferQueryLanguage_RepresentativeQueries(t *testing.T) {
	enES := []string{"en", "es"}
	tests := []struct {
		query string
		want  string
	}{
		// Representative calculator-site queries.
		{"how much house can i afford calculator", "en"},
		{"mortgage calculator", "en"},
		{"mortgage payment simulator", "en"},
		{"what if i refinance my mortgage calculator", "en"},
		{"simulador hipoteca", "es"},
		{"calculadora de cuota hipotecaria", "es"},
		{"invertir en vivienda desde españa", "es"},
		{"cuál es el broker con menos comisiones", "es"},
		// Skipped: brand, ticker, no evidence, other script.
		{"zillow", ""},
		{"acmecalc", ""},
		{"калькулятор ипотеки", ""},
		// Mixed evidence ties → skipped rather than guessed.
		{"calculadora mortgage calculator", ""},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			if got := InferQueryLanguage(tt.query, enES); got != tt.want {
				t.Errorf("InferQueryLanguage(%q) = %q, want %q", tt.query, got, tt.want)
			}
		})
	}
}

func TestInferQueryLanguage_CandidateRestriction(t *testing.T) {
	// "simulador" is valid Spanish and Portuguese; with both candidates it
	// ties and is skipped, with only one it resolves.
	if got := InferQueryLanguage("simulador", []string{"es", "pt"}); got != "" {
		t.Errorf("es/pt tie: got %q, want skip", got)
	}
	if got := InferQueryLanguage("simulação de juros", []string{"es", "pt"}); got != "pt" {
		t.Errorf("pt diacritics + words: got %q, want pt", got)
	}
	if got := InferQueryLanguage("zinseszins rechner", []string{"en", "de"}); got != "de" {
		t.Errorf("de: got %q", got)
	}
	if got := InferQueryLanguage("calculateur intérêts composés", []string{"en", "fr"}); got != "fr" {
		t.Errorf("fr: got %q", got)
	}
}

func TestInferQueryLanguage_RegionCodesAndUnsupported(t *testing.T) {
	if got := InferQueryLanguage("simulador hipoteca", []string{"en-US", "es-ES"}); got != "es" {
		t.Errorf("region-qualified codes: got %q, want es", got)
	}
	if got := InferQueryLanguage("home loan calculator", []string{"ja", "x-default"}); got != "" {
		t.Errorf("unsupported candidates only: got %q, want skip", got)
	}
	if !SupportedQueryLanguage("pt-BR") || SupportedQueryLanguage("ja") {
		t.Error("SupportedQueryLanguage mismatch")
	}
}
