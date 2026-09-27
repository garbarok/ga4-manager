package diagnostics

import (
	"strings"
	"unicode"
)

// Query-language inference for cross-language ranking detection (design D8).
//
// Search queries are 2–6 words, too short for statistical language
// detectors. Instead each supported language has a short list of function
// words plus the finance/calculator vocabulary typical of the sites this
// tool serves, and a bonus for language-specific characters. Scoring is
// restricted to the languages of the pair being checked, which removes most
// ambiguity (Spanish and Portuguese share "simulador"; with an en/es pair
// only Spanish can claim it).

var languageWords = map[string]map[string]bool{
	"en": wordSet(`the a an of in on for to how what much is if i my would be with and or per
		year years month monthly invested invest investing investment calculator calculate return returns
		growth savings saving account compound interest dividend dividends reinvested reinvestment
		retirement simulator historical best worth today ago money rule millionaire rate high yield`),
	"es": wordSet(`el la los las de del en para por con cómo como qué que cuánto cuanto cuál cual mejor
		invertir inversión inversion calculadora simulador simulación simulacion interés interes
		compuesto rentabilidad fondo fondos indexado ahorro ahorros cuenta jubilación jubilacion años
		mes mensual dividendos desde españa espana comisiones es regla impuesto`),
	"pt": wordSet(`o os as do da dos das em para por com como quanto melhor investir investimento
		calculadora simulador simulação simulacao juros compostos rendimento fundo índice indice
		poupança poupanca aposentadoria anos mês mensal dividendos de no na`),
	"fr": wordSet(`le la les de des du en pour par avec comment combien meilleur investir investissement
		calculateur calculatrice simulateur simulation intérêts interets composés composes rendement
		fonds épargne epargne retraite ans mois mensuel dividendes`),
	"de": wordSet(`der die das und mit für fur wie viel was bester investieren investition rechner
		zinseszins zinsen rendite fonds sparen rente jahre monat monatlich dividenden sparplan`),
}

// languageChars maps a character to the languages it is evidence for.
var languageChars = map[rune][]string{
	'ñ': {"es"}, '¿': {"es"}, '¡': {"es"},
	'á': {"es", "pt"}, 'í': {"es", "pt"}, 'ó': {"es", "pt"}, 'ú': {"es", "pt"},
	'é': {"es", "pt", "fr"},
	'ã': {"pt"}, 'õ': {"pt"},
	'ç': {"pt", "fr"}, 'â': {"pt", "fr"}, 'ê': {"pt", "fr"}, 'ô': {"pt", "fr"}, 'à': {"pt", "fr"},
	'è': {"fr"}, 'ù': {"fr"}, 'œ': {"fr"},
	'ä': {"de"}, 'ö': {"de"}, 'ü': {"de"}, 'ß': {"de"},
}

func wordSet(s string) map[string]bool {
	out := make(map[string]bool)
	for _, w := range strings.Fields(s) {
		out[w] = true
	}
	return out
}

// SupportedQueryLanguage reports whether base language code lang (e.g. "es")
// has a word list.
func SupportedQueryLanguage(lang string) bool {
	_, ok := languageWords[BaseLanguage(lang)]
	return ok
}

// BaseLanguage lowercases a hreflang code and strips any region subtag:
// "es-ES" → "es", "pt_BR" → "pt".
func BaseLanguage(code string) string {
	code = strings.ToLower(strings.TrimSpace(code))
	if i := strings.IndexAny(code, "-_"); i >= 0 {
		code = code[:i]
	}
	return code
}

// InferQueryLanguage returns the base code of the candidate language the
// query most likely belongs to, or "" when no candidate scores or the top
// two tie (brand names, tickers and mixed-language queries are skipped
// rather than guessed). Unsupported candidates are ignored.
func InferQueryLanguage(query string, candidates []string) string {
	tokens := strings.FieldsFunc(strings.ToLower(query), func(r rune) bool {
		return !unicode.IsLetter(r)
	})

	best, bestScore, second := "", 0, 0
	scored := make(map[string]bool)
	for _, c := range candidates {
		lang := BaseLanguage(c)
		words, ok := languageWords[lang]
		if !ok || scored[lang] {
			continue
		}
		scored[lang] = true

		score := 0
		for _, t := range tokens {
			if words[t] {
				score++
			}
		}
		seenChar := make(map[rune]bool)
		for _, r := range strings.ToLower(query) {
			if langs, ok := languageChars[r]; ok && !seenChar[r] && containsString(langs, lang) {
				seenChar[r] = true
				score++
			}
		}

		switch {
		case score > bestScore:
			second = bestScore
			best, bestScore = lang, score
		case score > second:
			second = score
		}
	}

	if bestScore == 0 || bestScore-second < 1 {
		return ""
	}
	return best
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
