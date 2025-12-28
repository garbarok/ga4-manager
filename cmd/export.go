package cmd

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/garbarok/ga4-manager/internal/config"
	"github.com/garbarok/ga4-manager/internal/ga4"
)

// ReportData holds all the data collected from a project report
type ReportData struct {
	ProjectName       string                  `json:"project_name"`
	PropertyID        string                  `json:"property_id"`
	Timestamp         string                  `json:"timestamp"`
	Conversions       []ConversionData        `json:"conversions"`
	Dimensions        []DimensionData         `json:"dimensions"`
	Metrics           []MetricData            `json:"metrics"`
	CalculatedMetrics []CalculatedMetricData  `json:"calculated_metrics"`
	Audiences         []AudienceData          `json:"audiences"`
	DataRetention     DataRetentionData       `json:"data_retention"`
	EnhancedMeasure   EnhancedMeasurementData `json:"enhanced_measurement"`
}

type ConversionData struct {
	EventName      string `json:"event_name" csv:"Event Name"`
	CountingMethod string `json:"counting_method" csv:"Counting Method"`
}

type DimensionData struct {
	DisplayName   string `json:"display_name" csv:"Display Name"`
	ParameterName string `json:"parameter_name" csv:"Parameter"`
	Scope         string `json:"scope" csv:"Scope"`
}

type MetricData struct {
	DisplayName     string `json:"display_name" csv:"Display Name"`
	ParameterName   string `json:"parameter_name" csv:"Parameter"`
	MeasurementUnit string `json:"measurement_unit" csv:"Unit"`
	Scope           string `json:"scope" csv:"Scope"`
}

type CalculatedMetricData struct {
	DisplayName string `json:"display_name" csv:"Display Name"`
	Formula     string `json:"formula" csv:"Formula"`
	MetricUnit  string `json:"metric_unit" csv:"Unit"`
}

type AudienceData struct {
	Name               string `json:"name" csv:"Name"`
	Category           string `json:"category" csv:"Category"`
	MembershipDuration int    `json:"membership_duration" csv:"Duration (days)"`
}

type DataRetentionData struct {
	EventDataRetention         string `json:"event_data_retention"`
	ResetUserDataOnNewActivity bool   `json:"reset_user_data_on_new_activity"`
}

type EnhancedMeasurementData struct {
	StreamName       string          `json:"stream_name"`
	MeasurementID    string          `json:"measurement_id"`
	Features         map[string]bool `json:"features"`
	SearchParameters string          `json:"search_parameters"`
}

// collectReportData gathers all report data from a project
func collectReportData(client *ga4.Client, project config.Project) (*ReportData, error) {
	data := &ReportData{
		ProjectName: project.Name,
		PropertyID:  project.PropertyID,
		Timestamp:   time.Now().Format(time.RFC3339),
	}

	// Collect conversions
	conversions, err := client.ListConversions(project.PropertyID)
	if err != nil {
		return nil, fmt.Errorf("failed to list conversions: %w", err)
	}
	for _, conv := range conversions {
		data.Conversions = append(data.Conversions, ConversionData{
			EventName:      conv.EventName,
			CountingMethod: conv.CountingMethod,
		})
	}

	// Collect dimensions
	dimensions, err := client.ListDimensions(project.PropertyID)
	if err != nil {
		return nil, fmt.Errorf("failed to list dimensions: %w", err)
	}
	for _, dim := range dimensions {
		data.Dimensions = append(data.Dimensions, DimensionData{
			DisplayName:   dim.DisplayName,
			ParameterName: dim.ParameterName,
			Scope:         dim.Scope,
		})
	}

	// Collect metrics
	metrics, err := client.ListCustomMetrics(project.PropertyID)
	if err == nil {
		for _, metric := range metrics {
			data.Metrics = append(data.Metrics, MetricData{
				DisplayName:     metric.DisplayName,
				ParameterName:   metric.ParameterName,
				MeasurementUnit: metric.MeasurementUnit,
				Scope:           metric.Scope,
			})
		}
	}

	// Collect calculated metrics
	calculatedMetrics, err := client.ListCalculatedMetrics(project.PropertyID)
	if err == nil {
		for _, calc := range calculatedMetrics {
			data.CalculatedMetrics = append(data.CalculatedMetrics, CalculatedMetricData{
				DisplayName: calc.DisplayName,
				Formula:     calc.Formula,
				MetricUnit:  calc.MetricUnit,
			})
		}
	}

	// Collect audiences
	audienceCategories := ga4.ListAudiencesByCategory(project)
	for _, category := range []string{"SEO", "Conversion", "Content", "Behavioral"} {
		if audiences, ok := audienceCategories[category]; ok {
			for _, aud := range audiences {
				data.Audiences = append(data.Audiences, AudienceData{
					Name:               aud.Name,
					Category:           aud.Category,
					MembershipDuration: aud.MembershipDuration,
				})
			}
		}
	}

	// Collect data retention
	retentionSettings, err := client.GetDataRetention(project.PropertyID)
	if err == nil {
		data.DataRetention = DataRetentionData{
			EventDataRetention:         retentionSettings.EventDataRetention,
			ResetUserDataOnNewActivity: retentionSettings.ResetUserDataOnNewActivity,
		}
	}

	// Collect enhanced measurement (simplified)
	emSummary, _ := client.GetEnhancedMeasurementSummary(project.PropertyID)
	if emSummary != "" {
		data.EnhancedMeasure = EnhancedMeasurementData{
			StreamName: "Enhanced Measurement Enabled",
			Features:   make(map[string]bool),
		}
	}

	return data, nil
}

// exportToJSON exports report data to JSON format
func exportToJSON(data *ReportData, outputPath string) error {
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal JSON: %w", err)
	}

	if outputPath == "" {
		fmt.Println(string(jsonData))
		return nil
	}

	if err := os.WriteFile(outputPath, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write JSON file: %w", err)
	}

	fmt.Printf("✓ Report exported to: %s\n", outputPath)
	return nil
}

// exportToCSV exports report data to CSV format (multiple files)
func exportToCSV(data *ReportData, outputPath string) error {
	// Determine base path
	basePath := outputPath
	if basePath == "" {
		basePath = fmt.Sprintf("ga4_report_%s_%s",
			sanitizeFilename(data.ProjectName),
			time.Now().Format("20060102_150405"))
	} else {
		basePath = strings.TrimSuffix(basePath, ".csv")
	}

	// Export conversions
	if len(data.Conversions) > 0 {
		convPath := basePath + "_conversions.csv"
		if err := writeCSV(convPath, []string{"Event Name", "Counting Method"}, data.Conversions); err != nil {
			return err
		}
		fmt.Printf("✓ Conversions exported to: %s\n", convPath)
	}

	// Export dimensions
	if len(data.Dimensions) > 0 {
		dimPath := basePath + "_dimensions.csv"
		if err := writeCSV(dimPath, []string{"Display Name", "Parameter", "Scope"}, data.Dimensions); err != nil {
			return err
		}
		fmt.Printf("✓ Dimensions exported to: %s\n", dimPath)
	}

	// Export metrics
	if len(data.Metrics) > 0 {
		metricPath := basePath + "_metrics.csv"
		if err := writeCSV(metricPath, []string{"Display Name", "Parameter", "Unit", "Scope"}, data.Metrics); err != nil {
			return err
		}
		fmt.Printf("✓ Metrics exported to: %s\n", metricPath)
	}

	// Export calculated metrics
	if len(data.CalculatedMetrics) > 0 {
		calcPath := basePath + "_calculated_metrics.csv"
		if err := writeCSV(calcPath, []string{"Display Name", "Formula", "Unit"}, data.CalculatedMetrics); err != nil {
			return err
		}
		fmt.Printf("✓ Calculated metrics exported to: %s\n", calcPath)
	}

	// Export audiences
	if len(data.Audiences) > 0 {
		audPath := basePath + "_audiences.csv"
		if err := writeCSV(audPath, []string{"Name", "Category", "Duration (days)"}, data.Audiences); err != nil {
			return err
		}
		fmt.Printf("✓ Audiences exported to: %s\n", audPath)
	}

	return nil
}

// writeCSV writes a slice of structs to CSV
func writeCSV(filepath string, headers []string, data interface{}) (err error) {
	file, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create CSV file: %w", err)
	}
	defer func() {
		if cerr := file.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Write header
	if err := writer.Write(headers); err != nil {
		return err
	}

	// Write data based on type
	switch v := data.(type) {
	case []ConversionData:
		for _, item := range v {
			if err := writer.Write([]string{item.EventName, item.CountingMethod}); err != nil {
				return err
			}
		}
	case []DimensionData:
		for _, item := range v {
			if err := writer.Write([]string{item.DisplayName, item.ParameterName, item.Scope}); err != nil {
				return err
			}
		}
	case []MetricData:
		for _, item := range v {
			if err := writer.Write([]string{item.DisplayName, item.ParameterName, item.MeasurementUnit, item.Scope}); err != nil {
				return err
			}
		}
	case []CalculatedMetricData:
		for _, item := range v {
			if err := writer.Write([]string{item.DisplayName, item.Formula, item.MetricUnit}); err != nil {
				return err
			}
		}
	case []AudienceData:
		for _, item := range v {
			if err := writer.Write([]string{item.Name, item.Category, fmt.Sprintf("%d", item.MembershipDuration)}); err != nil {
				return err
			}
		}
	}

	return nil
}

// exportToMarkdown exports report data to Markdown format
func exportToMarkdown(data *ReportData, outputPath string) error {
	var md strings.Builder

	// Header
	md.WriteString("# GA4 Configuration Report\n\n")
	md.WriteString(fmt.Sprintf("**Project:** %s  \n", data.ProjectName))
	md.WriteString(fmt.Sprintf("**Property ID:** %s  \n", data.PropertyID))
	md.WriteString(fmt.Sprintf("**Generated:** %s  \n\n", data.Timestamp))
	md.WriteString("---\n\n")

	// Conversions
	if len(data.Conversions) > 0 {
		md.WriteString("## 🎯 Conversions\n\n")
		md.WriteString("| Event Name | Counting Method |\n")
		md.WriteString("|------------|----------------|\n")
		for _, conv := range data.Conversions {
			md.WriteString(fmt.Sprintf("| %s | %s |\n", conv.EventName, conv.CountingMethod))
		}
		md.WriteString("\n")
	}

	// Dimensions
	if len(data.Dimensions) > 0 {
		md.WriteString("## 📊 Custom Dimensions\n\n")
		md.WriteString("| Display Name | Parameter | Scope |\n")
		md.WriteString("|--------------|-----------|-------|\n")
		for _, dim := range data.Dimensions {
			md.WriteString(fmt.Sprintf("| %s | %s | %s |\n", dim.DisplayName, dim.ParameterName, dim.Scope))
		}
		md.WriteString("\n")
	}

	// Metrics
	if len(data.Metrics) > 0 {
		md.WriteString("## 📈 Custom Metrics\n\n")
		md.WriteString("| Display Name | Parameter | Unit | Scope |\n")
		md.WriteString("|--------------|-----------|------|-------|\n")
		for _, metric := range data.Metrics {
			md.WriteString(fmt.Sprintf("| %s | %s | %s | %s |\n",
				metric.DisplayName, metric.ParameterName, metric.MeasurementUnit, metric.Scope))
		}
		md.WriteString("\n")
	}

	// Calculated Metrics
	if len(data.CalculatedMetrics) > 0 {
		md.WriteString("## 🧮 Calculated Metrics\n\n")
		md.WriteString("| Display Name | Formula | Unit |\n")
		md.WriteString("|--------------|---------|------|\n")
		for _, calc := range data.CalculatedMetrics {
			md.WriteString(fmt.Sprintf("| %s | `%s` | %s |\n", calc.DisplayName, calc.Formula, calc.MetricUnit))
		}
		md.WriteString("\n")
	}

	// Audiences
	if len(data.Audiences) > 0 {
		md.WriteString("## 👥 Audiences\n\n")
		md.WriteString("| Name | Category | Duration (days) |\n")
		md.WriteString("|------|----------|----------------|\n")
		for _, aud := range data.Audiences {
			md.WriteString(fmt.Sprintf("| %s | %s | %d |\n", aud.Name, aud.Category, aud.MembershipDuration))
		}
		md.WriteString("\n")
	}

	// Data Retention
	if data.DataRetention.EventDataRetention != "" {
		md.WriteString("## 🗄️ Data Retention\n\n")
		md.WriteString(fmt.Sprintf("- **Event Data Retention:** %s\n", data.DataRetention.EventDataRetention))
		md.WriteString(fmt.Sprintf("- **Reset on New Activity:** %t\n\n", data.DataRetention.ResetUserDataOnNewActivity))
	}

	content := md.String()

	if outputPath == "" {
		fmt.Println(content)
		return nil
	}

	if err := os.WriteFile(outputPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write Markdown file: %w", err)
	}

	fmt.Printf("✓ Report exported to: %s\n", outputPath)
	return nil
}

// sanitizeFilename removes invalid characters from filenames
func sanitizeFilename(name string) string {
	invalid := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|", " "}
	result := name
	for _, char := range invalid {
		result = strings.ReplaceAll(result, char, "_")
	}
	return strings.ToLower(result)
}

// generateDefaultFilename creates a default filename based on format
func generateDefaultFilename(projectName, format string) string {
	timestamp := time.Now().Format("20060102_150405")
	safeName := sanitizeFilename(projectName)
	return filepath.Join(".", fmt.Sprintf("ga4_report_%s_%s.%s", safeName, timestamp, format))
}
