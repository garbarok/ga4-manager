package cmd

import (
	"encoding/csv"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestExportToJSON(t *testing.T) {
	tests := []struct {
		name    string
		data    *ReportData
		wantErr bool
	}{
		{
			name: "valid export with all fields",
			data: &ReportData{
				ProjectName: "Test Project",
				PropertyID:  "123456789",
				Timestamp:   time.Now().Format(time.RFC3339),
				Conversions: []ConversionData{
					{EventName: "purchase", CountingMethod: "ONCE_PER_EVENT"},
				},
				Dimensions: []DimensionData{
					{ParameterName: "user_type", DisplayName: "User Type", Scope: "USER"},
				},
				Metrics: []MetricData{
					{ParameterName: "custom_value", DisplayName: "Custom Value", Scope: "EVENT", MeasurementUnit: "STANDARD"},
				},
			},
			wantErr: false,
		},
		{
			name: "empty data",
			data: &ReportData{
				ProjectName: "",
				PropertyID:  "",
				Timestamp:   time.Now().Format(time.RFC3339),
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create temp file
			tmpDir := t.TempDir()
			outputPath := filepath.Join(tmpDir, "report.json")

			// Export
			err := exportToJSON(tt.data, outputPath)
			if (err != nil) != tt.wantErr {
				t.Errorf("exportToJSON() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				// Verify file exists
				if _, err := os.Stat(outputPath); os.IsNotExist(err) {
					t.Errorf("exported file does not exist: %v", err)
					return
				}

				// Verify JSON is valid
				content, err := os.ReadFile(outputPath)
				if err != nil {
					t.Errorf("failed to read exported file: %v", err)
					return
				}

				var result ReportData
				if err := json.Unmarshal(content, &result); err != nil {
					t.Errorf("invalid JSON output: %v", err)
					return
				}

				// Verify key fields
				if result.ProjectName != tt.data.ProjectName {
					t.Errorf("ProjectName = %v, want %v", result.ProjectName, tt.data.ProjectName)
				}
				if result.PropertyID != tt.data.PropertyID {
					t.Errorf("PropertyID = %v, want %v", result.PropertyID, tt.data.PropertyID)
				}
			}
		})
	}
}

func TestExportToCSV(t *testing.T) {
	tests := []struct {
		name    string
		data    *ReportData
		wantErr bool
	}{
		{
			name: "valid CSV export with conversions",
			data: &ReportData{
				ProjectName: "Test Project",
				PropertyID:  "123456789",
				Timestamp:   time.Now().Format(time.RFC3339),
				Conversions: []ConversionData{
					{EventName: "purchase", CountingMethod: "ONCE_PER_EVENT"},
					{EventName: "sign_up", CountingMethod: "ONCE_PER_SESSION"},
				},
			},
			wantErr: false,
		},
		{
			name: "empty conversions",
			data: &ReportData{
				ProjectName: "Test Project",
				PropertyID:  "123456789",
				Timestamp:   time.Now().Format(time.RFC3339),
				Conversions: []ConversionData{},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()
			outputPath := filepath.Join(tmpDir, "report")

			err := exportToCSV(tt.data, outputPath)
			if (err != nil) != tt.wantErr {
				t.Errorf("exportToCSV() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				// exportToCSV creates separate files, check for conversions file
				conversionsPath := outputPath + "_conversions.csv"
				if len(tt.data.Conversions) > 0 {
					if _, err := os.Stat(conversionsPath); os.IsNotExist(err) {
						t.Errorf("expected conversions CSV file does not exist: %v", err)
						return
					}

					// Verify CSV is valid
					file, err := os.Open(conversionsPath)
					if err != nil {
						t.Errorf("failed to open exported file: %v", err)
						return
					}
					defer func() { _ = file.Close() }()

					reader := csv.NewReader(file)
					records, err := reader.ReadAll()
					if err != nil {
						t.Errorf("invalid CSV output: %v", err)
						return
					}

					// Should have header + data rows
					expectedRows := 1 + len(tt.data.Conversions) // header + data
					if len(records) != expectedRows {
						t.Errorf("expected %d rows, got %d", expectedRows, len(records))
					}
				}
			}
		})
	}
}

func TestExportToMarkdown(t *testing.T) {
	tests := []struct {
		name    string
		data    *ReportData
		wantErr bool
	}{
		{
			name: "valid markdown export",
			data: &ReportData{
				ProjectName: "Test Project",
				PropertyID:  "123456789",
				Timestamp:   time.Now().Format(time.RFC3339),
				Conversions: []ConversionData{
					{EventName: "purchase", CountingMethod: "ONCE_PER_EVENT"},
				},
				Dimensions: []DimensionData{
					{ParameterName: "user_type", DisplayName: "User Type", Scope: "USER"},
				},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()
			outputPath := filepath.Join(tmpDir, "report.md")

			err := exportToMarkdown(tt.data, outputPath)
			if (err != nil) != tt.wantErr {
				t.Errorf("exportToMarkdown() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				// Verify file exists and contains markdown
				content, err := os.ReadFile(outputPath)
				if err != nil {
					t.Errorf("failed to read exported file: %v", err)
					return
				}

				markdown := string(content)

				// Verify markdown structure
				if !strings.Contains(markdown, "# GA4 Configuration Report") {
					t.Error("markdown should contain main header")
				}
				if !strings.Contains(markdown, tt.data.ProjectName) {
					t.Error("markdown should contain project name")
				}
				if !strings.Contains(markdown, tt.data.PropertyID) {
					t.Error("markdown should contain property ID")
				}
			}
		})
	}
}

func TestWriteCSV(t *testing.T) {
	tests := []struct {
		name    string
		headers []string
		data    interface{}
		wantErr bool
	}{
		{
			name:    "conversion data",
			headers: []string{"Event Name", "Counting Method"},
			data: []ConversionData{
				{EventName: "purchase", CountingMethod: "ONCE_PER_EVENT"},
				{EventName: "sign_up", CountingMethod: "ONCE_PER_SESSION"},
			},
			wantErr: false,
		},
		{
			name:    "dimension data",
			headers: []string{"Parameter", "Display Name", "Scope"},
			data: []DimensionData{
				{ParameterName: "user_type", DisplayName: "User Type", Scope: "USER"},
			},
			wantErr: false,
		},
		{
			name:    "metric data",
			headers: []string{"Parameter", "Display Name", "Scope", "Unit"},
			data: []MetricData{
				{ParameterName: "custom_value", DisplayName: "Custom Value", Scope: "EVENT", MeasurementUnit: "STANDARD"},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()
			filePath := filepath.Join(tmpDir, "test.csv")

			err := writeCSV(filePath, tt.headers, tt.data)
			if (err != nil) != tt.wantErr {
				t.Errorf("writeCSV() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				// Verify CSV structure
				file, err := os.Open(filePath)
				if err != nil {
					t.Errorf("failed to open CSV file: %v", err)
					return
				}
				defer func() { _ = file.Close() }()

				reader := csv.NewReader(file)
				records, err := reader.ReadAll()
				if err != nil {
					t.Errorf("failed to read CSV: %v", err)
					return
				}

				// Verify headers
				if len(records) < 1 {
					t.Error("CSV should have at least headers")
					return
				}

				if len(records[0]) != len(tt.headers) {
					t.Errorf("header count = %d, want %d", len(records[0]), len(tt.headers))
				}
			}
		})
	}
}

func TestWriteCSV_VerifyFileClose(t *testing.T) {
	// This test verifies that the file is properly closed even on errors
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "test.csv")

	// First write should succeed
	err := writeCSV(filePath, []string{"Test"}, []ConversionData{{EventName: "test", CountingMethod: "ONCE"}})
	if err != nil {
		t.Errorf("first write failed: %v", err)
	}

	// Second write should succeed (file was properly closed)
	err = writeCSV(filePath, []string{"Test"}, []ConversionData{{EventName: "test2", CountingMethod: "ONCE"}})
	if err != nil {
		t.Errorf("second write failed (file may not have been closed): %v", err)
	}
}
