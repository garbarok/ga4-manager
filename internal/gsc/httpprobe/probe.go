// Package httpprobe fetches the Operator's own pages to read on-page signals
// (currently hreflang alternates) that no Google API exposes.
//
// Scope is deliberately narrow (design D7, BACKLOG open question 1):
// requests go only to hosts the caller allows (the config's GSC site),
// identify as ga4-manager/<version>, do not consult robots.txt (these are
// the Operator's own pages), follow at most MaxRedirects hops, and run at
// most Concurrency requests at once.
package httpprobe

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/html"
)

// Defaults for New.
const (
	DefaultConcurrency  = 4
	DefaultTimeout      = 10 * time.Second
	DefaultMaxRedirects = 5

	// maxBodyBytes caps how much HTML is read; hreflang links live in <head>.
	maxBodyBytes = 2 << 20
)

// ErrOffHost is returned (wrapped) when a URL or redirect target is not on
// an allowed host. No request is made to the off-host URL.
var ErrOffHost = errors.New("off-host URL refused")

// ErrTooManyRedirects is returned (wrapped) when a redirect chain exceeds
// MaxRedirects.
var ErrTooManyRedirects = errors.New("too many redirects")

// Alternate is one <link rel="alternate" hreflang="…" href="…"> entry, with
// href resolved to an absolute URL against the page's final URL.
type Alternate struct {
	Lang string
	Href string
}

// Page is the result of fetching one URL.
type Page struct {
	URL        string // as requested
	FinalURL   string // after redirects
	Status     int    // final HTTP status (0 when the request failed)
	Alternates []Alternate
	Err        error // non-nil when the page could not be fetched/read
	// Requested is true when an HTTP request was sent (false for invalid
	// or off-host URLs refused up front).
	Requested bool
}

// Prober fetches pages under the package's scope rules.
type Prober struct {
	UserAgent    string
	AllowHost    func(host string) bool
	Concurrency  int
	MaxRedirects int
	Client       *http.Client
}

// New returns a Prober with the default limits. allowHost decides which
// hosts may be requested; userAgent should be "ga4-manager/<version>".
func New(userAgent string, allowHost func(string) bool) *Prober {
	return &Prober{
		UserAgent:    userAgent,
		AllowHost:    allowHost,
		Concurrency:  DefaultConcurrency,
		MaxRedirects: DefaultMaxRedirects,
		Client:       &http.Client{Timeout: DefaultTimeout},
	}
}

// Fetch requests one URL and parses its hreflang alternates. Failures are
// reported on Page.Err rather than returned, so batch callers keep going.
func (p *Prober) Fetch(ctx context.Context, rawURL string) Page {
	page := Page{URL: rawURL}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		page.Err = fmt.Errorf("invalid URL %q", rawURL)
		return page
	}
	if !p.AllowHost(u.Hostname()) {
		page.Err = fmt.Errorf("%w: %s", ErrOffHost, rawURL)
		return page
	}

	client := *p.Client
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > p.MaxRedirects {
			return fmt.Errorf("%w (>%d)", ErrTooManyRedirects, p.MaxRedirects)
		}
		if !p.AllowHost(req.URL.Hostname()) {
			return fmt.Errorf("%w: redirect to %s", ErrOffHost, req.URL)
		}
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		page.Err = err
		return page
	}
	req.Header.Set("User-Agent", p.UserAgent)
	req.Header.Set("Accept", "text/html")

	page.Requested = true
	resp, err := client.Do(req)
	if err != nil {
		page.Err = err
		return page
	}
	defer func() { _ = resp.Body.Close() }()

	page.Status = resp.StatusCode
	page.FinalURL = resp.Request.URL.String()
	if resp.StatusCode != http.StatusOK {
		return page
	}

	alts, err := ParseAlternates(io.LimitReader(resp.Body, maxBodyBytes), resp.Request.URL)
	if err != nil {
		page.Err = err
		return page
	}
	page.Alternates = alts
	return page
}

// FetchAll fetches every URL with at most Concurrency requests in flight and
// returns pages keyed by requested URL. Duplicate URLs are fetched once.
func (p *Prober) FetchAll(ctx context.Context, urls []string) map[string]Page {
	concurrency := p.Concurrency
	if concurrency < 1 {
		concurrency = 1
	}
	out := make(map[string]Page, len(urls))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)

	seen := make(map[string]bool, len(urls))
	for _, u := range urls {
		if seen[u] {
			continue
		}
		seen[u] = true
		wg.Add(1)
		go func(u string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			page := p.Fetch(ctx, u)
			mu.Lock()
			out[u] = page
			mu.Unlock()
		}(u)
	}
	wg.Wait()
	return out
}

// ParseAlternates reads HTML and returns every <link rel="alternate"
// hreflang="…" href="…">, with href resolved against base.
func ParseAlternates(r io.Reader, base *url.URL) ([]Alternate, error) {
	z := html.NewTokenizer(r)
	var alts []Alternate
	for {
		switch z.Next() {
		case html.ErrorToken:
			if errors.Is(z.Err(), io.EOF) {
				return alts, nil
			}
			return alts, z.Err()
		case html.StartTagToken, html.SelfClosingTagToken:
			tok := z.Token()
			if tok.Data == "body" {
				// hreflang link elements are only valid in <head>.
				return alts, nil
			}
			if tok.Data != "link" {
				continue
			}
			var rel, lang, href string
			for _, a := range tok.Attr {
				switch strings.ToLower(a.Key) {
				case "rel":
					rel = strings.ToLower(a.Val)
				case "hreflang":
					lang = strings.TrimSpace(a.Val)
				case "href":
					href = strings.TrimSpace(a.Val)
				}
			}
			if lang == "" || href == "" || !hasToken(rel, "alternate") {
				continue
			}
			ref, err := url.Parse(href)
			if err != nil {
				continue
			}
			alts = append(alts, Alternate{Lang: lang, Href: base.ResolveReference(ref).String()})
		}
	}
}

func hasToken(list, token string) bool {
	for _, f := range strings.Fields(list) {
		if f == token {
			return true
		}
	}
	return false
}
