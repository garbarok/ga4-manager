package audit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newTestProber() *Prober { return NewProber(5*time.Second, "test-agent") }

func TestProbeClassifications(t *testing.T) {
	mux := http.NewServeMux()
	// 200 OK
	mux.HandleFunc("/ok/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	// 404
	mux.HandleFunc("/missing/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(404) })
	// non-slash -> 308 -> slash (200): trailing-slash redirect
	mux.HandleFunc("/page", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "/page/")
		w.WriteHeader(http.StatusPermanentRedirect)
	})
	mux.HandleFunc("/page/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	// old -> 301 -> new (200): real redirect to a different path
	mux.HandleFunc("/old/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "/new/")
		w.WriteHeader(http.StatusMovedPermanently)
	})
	mux.HandleFunc("/new/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	// redirect that lands on a 404 (the real-world bug shape)
	mux.HandleFunc("/gone/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "/dead/")
		w.WriteHeader(http.StatusMovedPermanently)
	})
	mux.HandleFunc("/dead/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(404) })
	// 403 → blocked (ambiguous CDN/rate-limit), not broken
	mux.HandleFunc("/forbidden/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(403) })

	srv := httptest.NewServer(mux)
	defer srv.Close()
	p := newTestProber()
	ctx := context.Background()

	tests := []struct {
		path           string
		wantClass      string
		wantRedirected bool
		wantStatus     int
	}{
		{"/ok/", ClassOK, false, 200},
		{"/missing/", ClassBroken, false, 404},
		{"/page", ClassRedirect, true, 200},
		{"/old/", ClassRedirect, true, 200},
		{"/gone/", ClassBroken, true, 404},
		{"/forbidden/", ClassBlocked, false, 403},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			r := p.Probe(ctx, srv.URL+tt.path)
			if r.Classification != tt.wantClass {
				t.Errorf("Classification = %q, want %q (issues: %v)", r.Classification, tt.wantClass, r.Issues)
			}
			if r.Redirected != tt.wantRedirected {
				t.Errorf("Redirected = %v, want %v", r.Redirected, tt.wantRedirected)
			}
			if r.FinalStatus != tt.wantStatus {
				t.Errorf("FinalStatus = %d, want %d", r.FinalStatus, tt.wantStatus)
			}
		})
	}
}

func TestProbeTrailingSlashIssue(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/page", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "/page/")
		w.WriteHeader(http.StatusPermanentRedirect)
	})
	mux.HandleFunc("/page/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	srv := httptest.NewServer(mux)
	defer srv.Close()

	r := newTestProber().Probe(context.Background(), srv.URL+"/page")
	found := false
	for _, iss := range r.Issues {
		if iss == "trailing-slash redirect: the requested URL is not the canonical (slash) form" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected trailing-slash issue, got %v", r.Issues)
	}
}

func TestProbeNetworkError(t *testing.T) {
	// Closed server → connection refused → ClassError, never panics.
	srv := httptest.NewServer(http.NewServeMux())
	addr := srv.URL
	srv.Close()
	r := newTestProber().Probe(context.Background(), addr+"/x")
	if r.Classification != ClassError {
		t.Errorf("Classification = %q, want %q", r.Classification, ClassError)
	}
	if r.Error == "" {
		t.Errorf("expected Error to be populated")
	}
}

func TestFetchSitemapIndex(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/sitemap-index.xml", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>` + baseURL + `/sitemap-0.xml</loc></sitemap>
</sitemapindex>`))
	})
	mux.HandleFunc("/sitemap-0.xml", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a/</loc></url>
  <url><loc>https://example.com/b/</loc></url>
</urlset>`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	baseURL = srv.URL // child loc is absolute against the test server

	urls, err := newTestProber().FetchSitemapURLs(context.Background(), srv.URL+"/sitemap-index.xml")
	if err != nil {
		t.Fatalf("FetchSitemapURLs error: %v", err)
	}
	if len(urls) != 2 || urls[0] != "https://example.com/a/" {
		t.Errorf("got %v, want 2 example.com URLs", urls)
	}
}

// baseURL is set by TestFetchSitemapIndex so the index can reference its child
// on the same ephemeral test server.
var baseURL string
