package diagnostics

import (
	"net/url"
	"sort"
	"strings"

	"github.com/garbarok/ga4-manager/internal/gsc"
)

// URL-hygiene issue types, in classification precedence order: a URL gets
// the first issue that matches.
const (
	HygieneMalformedPath  = "malformed_path"
	HygieneFragment       = "fragment"
	HygieneAssetRoute     = "asset_route"
	HygieneQueryDuplicate = "query_duplicate"
	HygieneUtilityPage    = "utility_page"
)

// Hygiene severities. Utility pages are informational: indexing a privacy
// policy is harmless, it only dilutes the report.
const (
	SeverityWarning = "warning"
	SeverityInfo    = "info"
)

// assetSegments are framework-generated routes (Next.js metadata images and
// icons) that serve images, not documents, and should never be search results.
var assetSegments = map[string]bool{
	"opengraph-image": true,
	"twitter-image":   true,
	"icon":            true,
	"apple-icon":      true,
}

var utilitySegments = map[string]bool{
	"privacy":    true,
	"terms":      true,
	"cookies":    true,
	"disclaimer": true,
	"legal":      true,
	"contact":    true,
}

var hygieneFixes = map[string]string{
	HygieneMalformedPath:  "Find the link that produced this path (usually a relative href missing a leading slash or scheme), fix it, and 301 the malformed URL to the intended page.",
	HygieneFragment:       "Google is listing an in-page anchor as its own result; make sure internal links and sitemaps point to the URL without #fragment and the page's canonical omits it.",
	HygieneAssetRoute:     "Framework asset route is being indexed; send X-Robots-Tag: noindex on it or disallow the route in robots.txt.",
	HygieneQueryDuplicate: "Same page is indexed with and without a query string; set a canonical to the clean URL and stop linking the parameterised variant.",
	HygieneUtilityPage:    "Legal/utility page earns impressions; usually harmless — consider noindex if it competes with real content.",
}

// HygieneFinding is one URL with search impressions that should not be an
// independent search result.
type HygieneFinding struct {
	URL         string
	Issue       string
	Severity    string
	Impressions int64
	Clicks      int64
	Fix         string
}

// URLHygiene classifies page-dimension rows. siteHosts are the host names
// the GSC site covers (e.g. "example.com"); a path segment equal to one of
// them, or a subdomain of one, marks a malformed path. URLs matching no rule
// are omitted. Results are sorted warning-first, then impressions desc, then
// URL asc.
func URLHygiene(rows []gsc.SearchAnalyticsRow, siteHosts []string) []HygieneFinding {
	seen := make(map[string]bool, len(rows))
	for _, r := range rows {
		if len(r.Keys) > 0 {
			seen[r.Keys[0]] = true
		}
	}

	findings := make([]HygieneFinding, 0)
	for _, r := range rows {
		if len(r.Keys) == 0 || r.Keys[0] == "" {
			continue
		}
		raw := r.Keys[0]
		issue := classifyHygiene(raw, siteHosts, seen)
		if issue == "" {
			continue
		}
		severity := SeverityWarning
		if issue == HygieneUtilityPage {
			severity = SeverityInfo
		}
		findings = append(findings, HygieneFinding{
			URL:         raw,
			Issue:       issue,
			Severity:    severity,
			Impressions: r.Impressions,
			Clicks:      r.Clicks,
			Fix:         hygieneFixes[issue],
		})
	}

	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].Severity != findings[j].Severity {
			return findings[i].Severity == SeverityWarning
		}
		if findings[i].Impressions != findings[j].Impressions {
			return findings[i].Impressions > findings[j].Impressions
		}
		return findings[i].URL < findings[j].URL
	})
	return findings
}

func classifyHygiene(raw string, siteHosts []string, seen map[string]bool) string {
	u, err := url.Parse(raw)
	if err != nil {
		return HygieneMalformedPath
	}
	path := u.EscapedPath()
	segments := strings.Split(strings.Trim(path, "/"), "/")

	if strings.Contains(path, "//") || hasHostSegment(segments, siteHosts) {
		return HygieneMalformedPath
	}
	if strings.Contains(raw, "#") {
		return HygieneFragment
	}
	if strings.HasPrefix(path, "/_next/") {
		return HygieneAssetRoute
	}
	for _, seg := range segments {
		if assetSegments[strings.ToLower(seg)] {
			return HygieneAssetRoute
		}
	}
	if u.RawQuery != "" {
		clean := *u
		clean.RawQuery = ""
		clean.ForceQuery = false
		if seen[clean.String()] {
			return HygieneQueryDuplicate
		}
	}
	if len(segments) > 0 && utilitySegments[strings.ToLower(segments[len(segments)-1])] {
		return HygieneUtilityPage
	}
	return ""
}

func hasHostSegment(segments []string, siteHosts []string) bool {
	for _, seg := range segments {
		seg = strings.ToLower(seg)
		for _, host := range siteHosts {
			host = strings.ToLower(host)
			if host != "" && (seg == host || strings.HasSuffix(seg, "."+host)) {
				return true
			}
		}
	}
	return false
}
