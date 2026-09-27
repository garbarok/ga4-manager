# Spec Delta

## Purpose

Defines the contract of the `adsense_report` MCP tool: which date windows it accepts, how rows are ordered, and how upstream AdSense errors are classified for the calling assistant.

## ADDED Requirements

### Requirement: Only API-supported date presets are accepted
The `date_range` input SHALL accept exactly `CUSTOM`, `TODAY`, `YESTERDAY`, `MONTH_TO_DATE`, `YEAR_TO_DATE`, `LAST_7_DAYS` and `LAST_30_DAYS`. Any other value SHALL be rejected with `INVALID_INPUT` before any network call. The hint SHALL tell the caller to use `CUSTOM` with `start_date`/`end_date` for longer windows. The tool's advertised JSON schema enum SHALL list the same values.

#### Scenario: Unsupported preset is rejected locally
- **WHEN** the tool is called with `date_range: "LAST_3_MONTHS"`
- **THEN** it returns `success: false` with `error.code: "INVALID_INPUT"` and a hint mentioning `CUSTOM`
- **AND** no request is sent to the AdSense API

#### Scenario: Supported preset succeeds
- **WHEN** the tool is called with `date_range: "LAST_30_DAYS"`
- **THEN** the request is sent with `dateRange=LAST_30_DAYS` and the result has `success: true`

### Requirement: Rows can be ordered by dimension or metric
The tool SHALL accept an optional `order_by` array of column names, each optionally prefixed with `+` (ascending) or `-` (descending). Each entry SHALL be passed to the API in order, so that `limit` truncates after sorting. Every entry, once its prefix is stripped, SHALL be one of the requested `metrics` or `dimensions`. Otherwise the tool SHALL return `INVALID_INPUT` without calling the API.

#### Scenario: Top countries by earnings
- **WHEN** the tool is called with `dimensions: ["COUNTRY_NAME"]`, `metrics: ["ESTIMATED_EARNINGS"]`, `order_by: ["-ESTIMATED_EARNINGS"]`, `limit: 10`
- **THEN** the returned rows are the 10 countries with the highest earnings, in descending order

#### Scenario: Order-by column not in the request
- **WHEN** `order_by` contains `-CLICKS` and `CLICKS` is not in `metrics`
- **THEN** the tool returns `INVALID_INPUT` naming the unknown column

#### Scenario: No ordering requested
- **WHEN** `order_by` is omitted
- **THEN** the request carries no `orderBy` parameter, which preserves current behavior

### Requirement: Upstream errors are classified by HTTP status
AdSense HTTP failures SHALL map to error codes as follows:
- 401 and 403 map to `AUTH_DENIED`.
- 404 maps to `NOT_FOUND`.
- 429 maps to `QUOTA_EXCEEDED`.
- Any other 4xx maps to `INVALID_INPUT`, and the message includes the upstream error text.
- 5xx maps to `UPSTREAM_5XX`.

#### Scenario: API rejects an argument
- **WHEN** the AdSense API responds with HTTP 400 `INVALID_ARGUMENT`
- **THEN** the tool returns `error.code: "INVALID_INPUT"` and the upstream message, not `UPSTREAM_5XX`

#### Scenario: Server-side failure
- **WHEN** the AdSense API responds with HTTP 503
- **THEN** the tool returns `error.code: "UPSTREAM_5XX"`
