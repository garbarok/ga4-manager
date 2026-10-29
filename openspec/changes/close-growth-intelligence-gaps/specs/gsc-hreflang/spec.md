# Spec Delta

## Purpose

Verifies that translated page pairs are wired together correctly, and detects searches in one language being answered by the page in another. Broken hreflang silently sends users to the wrong-language page (backlog BO-07).

## ADDED Requirements

### Requirement: Translation pairs come from config or are discovered
`ga4 gsc hreflang --config <file>` and the `gsc_hreflang` MCP tool SHALL use `search_console.hreflang_pairs` from the config when it is present. Each entry is a map of language code → absolute URL. When it is absent, the tool SHALL discover pairs by fetching each page that has search impressions in the window and reading its `<link rel="alternate" hreflang>` annotations. Discovery SHALL cap fetched pages at `max_pages` (default 50), chosen by impressions descending.

#### Scenario: Pairs declared in config
- **WHEN** the config declares `hreflang_pairs: [{en: ".../mortgage-calculator", es: ".../calculadora-hipoteca"}]`
- **THEN** exactly that pair is checked and no discovery fetches are made

#### Scenario: No pairs anywhere
- **WHEN** no config pairs exist and no fetched page declares hreflang alternates
- **THEN** the result contains a single `no_hreflang` info finding and the CLI exits 0

### Requirement: Annotation integrity checks
For each pair, the tool SHALL fetch every member page and report:
- `missing_return_link`: page A lists B as an alternate but B does not list A.
- `missing_self_reference`: a page does not list itself.
- `wrong_target`: an annotation URL differs from the pair member after normalization (lowercased host, trailing slash stripped), or answers with a non-200 status after at most 5 redirect hops.
- `missing_x_default`: no `x-default` entry. This is severity `info`.

#### Scenario: One-way annotation
- **WHEN** the English page lists the Spanish page as `hreflang="es"` but the Spanish page has no `hreflang="en"` entry
- **THEN** a `missing_return_link` warning is reported on the Spanish page

### Requirement: Cross-language ranking detection
For each pair, the tool SHALL pull query×page rows and flag `cross_language_ranking` when a query in one pair language gets ≥ `min_impressions` (default 10) on the member page for the other language. The query's language is inferred from the query text (see design). Each finding SHALL include the query, the page it ranks on, the expected page, and impressions.

#### Scenario: English query on Spanish page
- **WHEN** the query "how much house can i afford calculator" gets 25 impressions on the `es` member page of a pair
- **THEN** a `cross_language_ranking` warning names the `en` member as the expected page

### Requirement: Output contract
The JSON output SHALL include `results` (each with `pair`, `page`, `issue`, `severity` and `detail`), `pages_fetched` and `quota_used` (Search Analytics calls only). The CLI SHALL exit 2 when any warning exists, 0 otherwise, and 1 on failure. Outbound fetches SHALL identify as `ga4-manager/<version>` and be limited to the configured site's host.

#### Scenario: Off-site alternate
- **WHEN** a page's hreflang annotation points to a different host
- **THEN** that URL is not fetched and a `wrong_target` warning is reported
