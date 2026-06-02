# GA4 Constraints

Non-obvious constraints that affect what tasks are possible in this codebase.

## Permanently Reserved Parameter Names

Archived GA4 custom dimensions and metrics permanently reserve their parameter name — you cannot reuse the name once archived, even after deletion. Workaround: use a new name (e.g. `user_type_v2`) or un-archive via the GA4 UI.

### Reserved prefixes (rejected at validation time)

Parameter names and event names cannot start with: `google_`, `ga_`, `firebase_`

### Blocked specific names (rejected by the API regardless of prefix)

These names are reserved by GA4 and cannot be used for custom dimensions or metrics:

- `session_id`
- `user_id`
- `ga_session_id`
- `ga_session_number`
- `engagement_time_msec`
- `firebase_screen`
- `firebase_screen_class`

Source: `internal/config/limits.go:ReservedParameters`

## API Limitations

| Resource | Status |
|----------|--------|
| Audiences | Manual creation only — GA4 Admin API does not support programmatic audience creation |
| Search Console Links | Manual only — no API available |
| BigQuery Links | List/retrieve only — no create via API |
| Channel Groups | Fully supported |

## GSC URL Inspection Quota

The Search Console URL Inspection API enforces a **2,000 requests/day** limit per property. The GSC client tracks usage internally and emits warnings at 1,500 (75%) and errors at 1,900 (95%). Quota resets at midnight. Bulk inspection tools (`gsc_monitor_urls`, `gsc_index_coverage`) consume this quota — avoid running them multiple times in a single day on large sites.

Source: `internal/gsc/client.go:QuotaTracker`
