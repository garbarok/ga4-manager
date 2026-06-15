// Package audit probes URLs over HTTP to surface indexing-impacting problems
// that the Search Console API alone cannot see: pages that 404, redirect
// chains, and trailing-slash mismatches between the URL Google has indexed and
// the canonical URL the site actually serves.
//
// It is deliberately decoupled from the GSC client: callers supply the set of
// URLs to probe (typically the union of sitemap entries and pages that have
// search impressions) and this package reports each URL's live HTTP outcome.
package audit

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultUserAgent identifies as Googlebot by default: the goal is to observe
// what Google sees, and many CDNs (Cloudflare, etc.) challenge unknown agents
// while allowing the documented Googlebot UA.
const DefaultUserAgent = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"

// DefaultMaxHops bounds redirect-chain following.
const DefaultMaxHops = 10

const maxBodyBytes = 20 << 20 // 20 MiB cap when reading sitemap bodies

// Classification buckets for a probed URL.
const (
	ClassOK       = "ok"       // terminal 2xx, no redirect
	ClassRedirect = "redirect" // terminal 2xx reached via one or more redirects
	ClassBroken   = "broken"   // terminal status >= 400 (excluding the blocked set)
	ClassBlocked  = "blocked"  // 401/403/429 — often CDN bot protection / rate-limiting, ambiguous
	ClassError    = "error"    // transport error: no HTTP response obtained
)

// isBlockedStatus reports whether a status is one CDNs commonly return for bot
// protection or rate-limiting rather than a genuine "page is gone" error.
func isBlockedStatus(status int) bool {
	return status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusTooManyRequests
}

// Hop is one step in a redirect chain.
type Hop struct {
	URL      string `json:"url"`
	Status   int    `json:"status"`
	Location string `json:"location,omitempty"`
}

// URLAudit is the live-HTTP outcome for a single URL.
type URLAudit struct {
	URL            string   `json:"url"`
	Sources        []string `json:"sources,omitempty"` // e.g. ["sitemap","gsc"]
	Impressions    int64    `json:"impressions,omitempty"`
	FinalURL       string   `json:"final_url,omitempty"`
	FinalStatus    int      `json:"final_status"`
	Redirected     bool     `json:"redirected"`
	RedirectChain  []Hop    `json:"redirect_chain,omitempty"`
	Classification string   `json:"classification"`
	Issues         []string `json:"issues,omitempty"`
	Error          string   `json:"error,omitempty"`
}

// Prober performs HTTP probes. The zero value is not usable; call NewProber.
type Prober struct {
	noFollow  *http.Client // does not auto-follow redirects (probe path)
	follow    *http.Client // follows redirects (sitemap fetch path)
	userAgent string
	maxHops   int
}

// NewProber builds a Prober with the given per-request timeout and User-Agent.
// An empty userAgent falls back to DefaultUserAgent.
func NewProber(timeout time.Duration, userAgent string) *Prober {
	if userAgent == "" {
		userAgent = DefaultUserAgent
	}
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &Prober{
		noFollow: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		follow:    &http.Client{Timeout: timeout},
		userAgent: userAgent,
		maxHops:   DefaultMaxHops,
	}
}

// Probe fetches rawURL, manually following redirects up to maxHops, and returns
// a classified result. It never returns an error: transport failures are
// captured as ClassError on the result so a single dead URL cannot abort a
// batch.
func (p *Prober) Probe(ctx context.Context, rawURL string) URLAudit {
	res := URLAudit{URL: rawURL}
	current := rawURL

	for hop := 0; ; hop++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, current, nil)
		if err != nil {
			res.Classification = ClassError
			res.Error = err.Error()
			res.FinalURL = current
			return res
		}
		req.Header.Set("User-Agent", p.userAgent)

		resp, err := p.noFollow.Do(req)
		if err != nil {
			res.Classification = ClassError
			res.Error = err.Error()
			res.FinalURL = current
			return res
		}
		status := resp.StatusCode
		location := resp.Header.Get("Location")
		_ = resp.Body.Close()

		if isRedirect(status) && location != "" {
			res.Redirected = true
			res.RedirectChain = append(res.RedirectChain, Hop{URL: current, Status: status, Location: location})

			next := resolveLocation(current, location)
			if next == "" {
				res.FinalURL = current
				res.FinalStatus = status
				res.Issues = append(res.Issues, "redirect with unparseable Location header")
				break
			}
			if hop >= p.maxHops {
				res.FinalURL = next
				res.FinalStatus = status
				res.Issues = append(res.Issues, fmt.Sprintf("redirect chain exceeded %d hops", p.maxHops))
				break
			}
			current = next
			continue
		}

		res.FinalURL = current
		res.FinalStatus = status
		break
	}

	classify(&res)
	return res
}

// classify sets Classification and prepends a human-readable issue describing
// the outcome. Callers may have appended chain-related issues already.
func classify(r *URLAudit) {
	switch {
	case isBlockedStatus(r.FinalStatus):
		// Ambiguous: usually CDN bot protection or rate-limiting from a
		// non-Google IP, not a genuinely broken page. Reported but never
		// treated as a hard failure by callers.
		r.Classification = ClassBlocked
		r.Issues = append([]string{fmt.Sprintf("returns %d — likely CDN bot protection or rate-limiting, not necessarily broken (retry with --concurrency 1)", r.FinalStatus)}, r.Issues...)
	case r.FinalStatus >= 400:
		r.Classification = ClassBroken
		if r.Redirected {
			r.Issues = append([]string{fmt.Sprintf("redirects to a %d (%s)", r.FinalStatus, r.FinalURL)}, r.Issues...)
		} else {
			r.Issues = append([]string{fmt.Sprintf("returns %d", r.FinalStatus)}, r.Issues...)
		}
	case r.Redirected:
		r.Classification = ClassRedirect
		if slashOnlyDifference(r.URL, r.FinalURL) {
			r.Issues = append(r.Issues, "trailing-slash redirect: the requested URL is not the canonical (slash) form")
		} else {
			r.Issues = append(r.Issues, fmt.Sprintf("redirects to %s", r.FinalURL))
		}
	default:
		r.Classification = ClassOK
	}
}

func isRedirect(status int) bool {
	switch status {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther,
		http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	}
	return false
}

// resolveLocation resolves a (possibly relative) Location header against the
// current URL. Returns "" if either cannot be parsed.
func resolveLocation(current, location string) string {
	base, err := url.Parse(current)
	if err != nil {
		return ""
	}
	loc, err := url.Parse(location)
	if err != nil {
		return ""
	}
	return base.ResolveReference(loc).String()
}

// slashOnlyDifference reports whether two URLs are identical except for a
// trailing slash on the path (e.g. /a/b vs /a/b/).
func slashOnlyDifference(a, b string) bool {
	ua, err := url.Parse(a)
	if err != nil {
		return false
	}
	ub, err := url.Parse(b)
	if err != nil {
		return false
	}
	if ua.Scheme != ub.Scheme || ua.Host != ub.Host || ua.RawQuery != ub.RawQuery {
		return false
	}
	return strings.TrimSuffix(ua.Path, "/") == strings.TrimSuffix(ub.Path, "/") && ua.Path != ub.Path
}

// --- Sitemap parsing -------------------------------------------------------

type sitemapIndex struct {
	XMLName  xml.Name `xml:"sitemapindex"`
	Sitemaps []struct {
		Loc string `xml:"loc"`
	} `xml:"sitemap"`
}

type urlSet struct {
	XMLName xml.Name `xml:"urlset"`
	URLs    []struct {
		Loc string `xml:"loc"`
	} `xml:"url"`
}

// FetchSitemapURLs fetches sitemapURL and returns every <loc> it contains. If
// the document is a <sitemapindex>, each referenced child sitemap is fetched
// and its URLs are concatenated. Child-sitemap fetch failures are skipped so a
// single bad child does not fail the whole call.
func (p *Prober) FetchSitemapURLs(ctx context.Context, sitemapURL string) ([]string, error) {
	body, err := p.fetchBody(ctx, sitemapURL)
	if err != nil {
		return nil, err
	}

	var idx sitemapIndex
	if err := xml.Unmarshal(body, &idx); err == nil && len(idx.Sitemaps) > 0 {
		var all []string
		for _, sm := range idx.Sitemaps {
			loc := strings.TrimSpace(sm.Loc)
			if loc == "" {
				continue
			}
			child, err := p.fetchBody(ctx, loc)
			if err != nil {
				continue
			}
			all = append(all, parseURLSet(child)...)
		}
		return all, nil
	}

	if urls := parseURLSet(body); len(urls) > 0 {
		return urls, nil
	}
	return nil, fmt.Errorf("not a recognised sitemap or sitemap index: %s", sitemapURL)
}

func parseURLSet(body []byte) []string {
	var us urlSet
	if err := xml.Unmarshal(body, &us); err != nil {
		return nil
	}
	urls := make([]string, 0, len(us.URLs))
	for _, u := range us.URLs {
		if loc := strings.TrimSpace(u.Loc); loc != "" {
			urls = append(urls, loc)
		}
	}
	return urls
}

func (p *Prober) fetchBody(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", p.userAgent)
	resp, err := p.follow.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch %s: HTTP %d", rawURL, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
}
