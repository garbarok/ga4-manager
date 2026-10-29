# ADR-0002: Use GA4 Admin API v1alpha

**Status:** Accepted  
**Date:** 2025-11-22

## Context

Google provides two versions of the GA4 Admin API: `v1beta` (stable subset) and `v1alpha` (full feature set, including custom dimensions, custom metrics, conversion events, and channel groups). Key resources this project needs — particularly `CustomDimensions`, `CustomMetrics`, and `ChannelGroups` — are only available in v1alpha.

## Decision

Use `google.golang.org/api/analyticsadmin/v1alpha` throughout `internal/ga4/`.

## Consequences

- Full access to all GA4 Admin API resources including channel groups and calculated metrics.
- v1alpha is not a stability guarantee — Google may change or remove endpoints without a deprecation window. Monitor the [GA4 Admin API release notes](https://developers.google.com/analytics/devguides/config/admin/v1/release-notes) for breaking changes.
- Migrating to v1beta in the future would require auditing which resources have graduated and replacing API calls selectively.
