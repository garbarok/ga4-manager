package seo

// CoreWebVitalsThresholds defines the thresholds for Core Web Vitals metrics
// Based on https://web.dev/vitals/

const (
	// Largest Contentful Paint (LCP) - in milliseconds
	LCPGood              = 2500
	LCPNeedsImprovement  = 4000

	// First Input Delay (FID) - in milliseconds
	FIDGood              = 100
	FIDNeedsImprovement  = 300

	// Cumulative Layout Shift (CLS) - score
	CLSGood              = 0.1
	CLSNeedsImprovement  = 0.25

	// Interaction to Next Paint (INP) - in milliseconds
	INPGood              = 200
	INPNeedsImprovement  = 500

	// Time to First Byte (TTFB) - in milliseconds
	TTFBGood             = 800
	TTFBNeedsImprovement = 1800
)

// Rating represents the performance rating
type Rating string

const (
	RatingGood              Rating = "good"
	RatingNeedsImprovement  Rating = "needs-improvement"
	RatingPoor              Rating = "poor"
)

// CoreWebVitals represents all Core Web Vitals metrics
type CoreWebVitals struct {
	LCP    float64
	FID    float64
	CLS    float64
	INP    float64
	TTFB   float64
}

// GetLCPRating returns the rating for LCP metric
func GetLCPRating(lcp float64) Rating {
	if lcp <= LCPGood {
		return RatingGood
	} else if lcp <= LCPNeedsImprovement {
		return RatingNeedsImprovement
	}
	return RatingPoor
}

// GetFIDRating returns the rating for FID metric
func GetFIDRating(fid float64) Rating {
	if fid <= FIDGood {
		return RatingGood
	} else if fid <= FIDNeedsImprovement {
		return RatingNeedsImprovement
	}
	return RatingPoor
}

// GetCLSRating returns the rating for CLS metric
func GetCLSRating(cls float64) Rating {
	if cls <= CLSGood {
		return RatingGood
	} else if cls <= CLSNeedsImprovement {
		return RatingNeedsImprovement
	}
	return RatingPoor
}

// GetINPRating returns the rating for INP metric
func GetINPRating(inp float64) Rating {
	if inp <= INPGood {
		return RatingGood
	} else if inp <= INPNeedsImprovement {
		return RatingNeedsImprovement
	}
	return RatingPoor
}

// GetTTFBRating returns the rating for TTFB metric
func GetTTFBRating(ttfb float64) Rating {
	if ttfb <= TTFBGood {
		return RatingGood
	} else if ttfb <= TTFBNeedsImprovement {
		return RatingNeedsImprovement
	}
	return RatingPoor
}

// GetOverallRating calculates overall Web Vitals rating
// Returns "good" only if all metrics are good
// Returns "poor" if any metric is poor
// Otherwise returns "needs-improvement"
func (cwv *CoreWebVitals) GetOverallRating() Rating {
	lcpRating := GetLCPRating(cwv.LCP)
	fidRating := GetFIDRating(cwv.FID)
	clsRating := GetCLSRating(cwv.CLS)
	inpRating := GetINPRating(cwv.INP)
	ttfbRating := GetTTFBRating(cwv.TTFB)

	// If any metric is poor, overall is poor
	if lcpRating == RatingPoor || fidRating == RatingPoor ||
	   clsRating == RatingPoor || inpRating == RatingPoor ||
	   ttfbRating == RatingPoor {
		return RatingPoor
	}

	// If all metrics are good, overall is good
	if lcpRating == RatingGood && fidRating == RatingGood &&
	   clsRating == RatingGood && inpRating == RatingGood &&
	   ttfbRating == RatingGood {
		return RatingGood
	}

	// Otherwise, needs improvement
	return RatingNeedsImprovement
}

// EventParameters returns a map of event parameters for GA4
func (cwv *CoreWebVitals) EventParameters() map[string]interface{} {
	return map[string]interface{}{
		"lcp_score":          cwv.LCP,
		"fid_score":          cwv.FID,
		"cls_score":          cwv.CLS,
		"inp_score":          cwv.INP,
		"ttfb_score":         cwv.TTFB,
		"web_vitals_rating":  string(cwv.GetOverallRating()),
		"lcp_rating":         string(GetLCPRating(cwv.LCP)),
		"fid_rating":         string(GetFIDRating(cwv.FID)),
		"cls_rating":         string(GetCLSRating(cwv.CLS)),
		"inp_rating":         string(GetINPRating(cwv.INP)),
		"ttfb_rating":        string(GetTTFBRating(cwv.TTFB)),
	}
}

// Validate checks if all metrics have reasonable values
func (cwv *CoreWebVitals) Validate() bool {
	// Check for negative or unrealistic values
	if cwv.LCP < 0 || cwv.LCP > 30000 { // Max 30 seconds
		return false
	}
	if cwv.FID < 0 || cwv.FID > 10000 { // Max 10 seconds
		return false
	}
	if cwv.CLS < 0 || cwv.CLS > 5 { // CLS rarely exceeds 5
		return false
	}
	if cwv.INP < 0 || cwv.INP > 10000 { // Max 10 seconds
		return false
	}
	if cwv.TTFB < 0 || cwv.TTFB > 30000 { // Max 30 seconds
		return false
	}
	return true
}

// GetImplementationExample returns JavaScript code example for tracking Core Web Vitals
func GetImplementationExample() string {
	return `// Core Web Vitals Tracking Example (using web-vitals library)
import {onCLS, onFID, onLCP, onINP, onTTFB} from 'web-vitals';

function sendToGA4(metric) {
  const value = Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value);

  gtag('event', metric.rating === 'good' ? 'core_web_vitals_pass' : 'core_web_vitals_fail', {
    lcp_score: metric.name === 'LCP' ? value : undefined,
    fid_score: metric.name === 'FID' ? value : undefined,
    cls_score: metric.name === 'CLS' ? value / 1000 : undefined,
    inp_score: metric.name === 'INP' ? value : undefined,
    ttfb_score: metric.name === 'TTFB' ? value : undefined,
    web_vitals_rating: metric.rating,
    metric_name: metric.name,
    metric_value: value,
    metric_delta: metric.delta,
    metric_id: metric.id,
  });
}

// Track all Core Web Vitals
onCLS(sendToGA4);
onFID(sendToGA4);
onLCP(sendToGA4);
onINP(sendToGA4);
onTTFB(sendToGA4);`
}
