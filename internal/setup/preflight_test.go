package setup

import (
	"io"
	"log/slog"
	"testing"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/stretchr/testify/assert"
)

// GA4 display names live in one namespace across dimensions AND metrics, so a
// metric reusing a dimension's display_name must fail preflight (it would 409
// at create time).
func TestValidateGA4Resources_DuplicateDisplayNameAcrossSections(t *testing.T) {
	cfg := &config.ProjectConfig{
		Dimensions: []config.DimensionConfig{
			{ParameterName: "article_word_count", DisplayName: "Article Word Count", Scope: "EVENT"},
		},
		Metrics: []config.MetricConfig{
			{ParameterName: "word_count", DisplayName: "Article Word Count", MeasurementUnit: "STANDARD", Scope: "EVENT"},
		},
	}
	pv := NewPreflightValidator(cfg, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	result := pv.ValidateGA4Resources()

	assert.Equal(t, ValidationFailed, result.Status)
	assert.Contains(t, result.Error.Error(), `duplicate display_name "Article Word Count"`)
}

func TestValidateGA4Resources_UniqueDisplayNamesPass(t *testing.T) {
	cfg := &config.ProjectConfig{
		Dimensions: []config.DimensionConfig{
			{ParameterName: "author", DisplayName: "Author", Scope: "EVENT"},
		},
		Metrics: []config.MetricConfig{
			{ParameterName: "word_count", DisplayName: "Article Word Count", MeasurementUnit: "STANDARD", Scope: "EVENT"},
		},
	}
	pv := NewPreflightValidator(cfg, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	result := pv.ValidateGA4Resources()

	assert.Equal(t, ValidationPassed, result.Status)
}
