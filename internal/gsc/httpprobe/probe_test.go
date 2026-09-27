package httpprobe

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const pageHTML = `<!doctype html><html><head>
<link rel="canonical" href="/en/a">
<link rel="alternate" hreflang="en" href="/en/a">
<link rel="alternate" hreflang="es" href="https://HOST/es/a">
<link rel="alternate stylesheet" href="/x.css">
<link rel="alternate" hreflang="x-default" href="/en/a" />
</head><body>
<link rel="alternate" hreflang="fr" href="/fr/a">
</body></html>`

func newServer(t *testing.T, mux *http.ServeMux) (*httptest.Server, string) {
	t.Helper()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	return srv, u.Hostname()
}

func TestParseAlternates_ResolvesAndStopsAtBody(t *testing.T) {
	base, _ := url.Parse("https://example.com/en/a")
	alts, err := ParseAlternates(strings.NewReader(strings.ReplaceAll(pageHTML, "HOST", "example.com")), base)
	if err != nil {
		t.Fatal(err)
	}
	want := []Alternate{
		{"en", "https://example.com/en/a"},
		{"es", "https://example.com/es/a"},
		{"x-default", "https://example.com/en/a"},
	}
	if fmt.Sprint(alts) != fmt.Sprint(want) {
		t.Errorf("alternates = %v, want %v (body-level links must be ignored)", alts, want)
	}
}

func TestFetch_ReadsAlternatesAndSendsUserAgent(t *testing.T) {
	var gotUA atomic.Value
	mux := http.NewServeMux()
	mux.HandleFunc("/en/a", func(w http.ResponseWriter, r *http.Request) {
		gotUA.Store(r.UserAgent())
		_, _ = w.Write([]byte(strings.ReplaceAll(pageHTML, "HOST", r.Host)))
	})
	srv, host := newServer(t, mux)

	p := New("ga4-manager/test", func(h string) bool { return h == host })
	page := p.Fetch(context.Background(), srv.URL+"/en/a")
	if page.Err != nil || page.Status != 200 {
		t.Fatalf("page = %+v", page)
	}
	if len(page.Alternates) != 3 {
		t.Errorf("alternates = %v", page.Alternates)
	}
	if gotUA.Load() != "ga4-manager/test" {
		t.Errorf("User-Agent = %v", gotUA.Load())
	}
}

func TestFetch_RefusesOffHostWithoutRequest(t *testing.T) {
	var hits atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { hits.Add(1) })
	srv, _ := newServer(t, mux)

	p := New("ua", func(string) bool { return false })
	page := p.Fetch(context.Background(), srv.URL+"/x")
	if !errors.Is(page.Err, ErrOffHost) {
		t.Errorf("err = %v, want ErrOffHost", page.Err)
	}
	if hits.Load() != 0 || page.Requested {
		t.Errorf("off-host URL was requested (hits %d, Requested %v)", hits.Load(), page.Requested)
	}
}

func TestFetch_RefusesOffHostRedirect(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/go", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://elsewhere.example/landing", http.StatusMovedPermanently)
	})
	srv, host := newServer(t, mux)

	p := New("ua", func(h string) bool { return h == host })
	page := p.Fetch(context.Background(), srv.URL+"/go")
	if !errors.Is(page.Err, ErrOffHost) || !page.Requested {
		t.Errorf("err = %v requested = %v, want ErrOffHost after a real request", page.Err, page.Requested)
	}
}

func TestFetch_CapsRedirects(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/loop", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/loop", http.StatusFound)
	})
	srv, host := newServer(t, mux)

	p := New("ua", func(h string) bool { return h == host })
	page := p.Fetch(context.Background(), srv.URL+"/loop")
	if !errors.Is(page.Err, ErrTooManyRedirects) {
		t.Errorf("err = %v, want ErrTooManyRedirects", page.Err)
	}
}

func TestFetch_FollowsSameHostRedirectAndReportsFinalURL(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/old", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/new", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/new", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("<html></html>")) })
	srv, host := newServer(t, mux)

	page := New("ua", func(h string) bool { return h == host }).Fetch(context.Background(), srv.URL+"/old")
	if page.Status != 200 || !strings.HasSuffix(page.FinalURL, "/new") {
		t.Errorf("page = %+v", page)
	}
}

func TestFetch_Non200HasNoAlternates(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/gone", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) })
	srv, host := newServer(t, mux)

	page := New("ua", func(h string) bool { return h == host }).Fetch(context.Background(), srv.URL+"/gone")
	if page.Status != 404 || page.Err != nil || len(page.Alternates) != 0 {
		t.Errorf("page = %+v", page)
	}
}

func TestFetchAll_BoundsConcurrencyAndDedupes(t *testing.T) {
	var inFlight, peak, hits atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		n := inFlight.Add(1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		inFlight.Add(-1)
		_, _ = w.Write([]byte("<html></html>"))
	})
	srv, host := newServer(t, mux)

	var urls []string
	for i := 0; i < 12; i++ {
		urls = append(urls, fmt.Sprintf("%s/p%d", srv.URL, i))
	}
	urls = append(urls, urls[0]) // duplicate

	p := New("ua", func(h string) bool { return h == host })
	pages := p.FetchAll(context.Background(), urls)
	if len(pages) != 12 || hits.Load() != 12 {
		t.Errorf("pages = %d, hits = %d, want 12/12", len(pages), hits.Load())
	}
	if peak.Load() > DefaultConcurrency {
		t.Errorf("peak concurrency = %d, want ≤ %d", peak.Load(), DefaultConcurrency)
	}
}
