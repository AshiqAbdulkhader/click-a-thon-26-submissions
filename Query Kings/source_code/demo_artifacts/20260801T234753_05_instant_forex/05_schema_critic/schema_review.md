# Schema Review

## Verdict

Pass for v0 instrumentation.

## What this schema optimizes for

- Feature workflow: `funnel`
- Primary entity: `application_id`
- Success event: `forex_purchased`
- Partitioning: `toYYYYMM(timestamp)`
- Ordering key: `(timestamp, event_id)`

## Checks

- No blocking issues found.

## Notes

- Raw payload is preserved in `raw_json` for replay and hidden-spec debugging.
- `ReplacingMergeTree` is used so repeated `event_id` values can collapse during merges.
- TTL is set to `timestamp + INTERVAL 18 MONTH`; adjust if judges ask for longer retention.
- Materialized views: `instant_forex_events_daily_event_counts_mv`, `instant_forex_events_daily_conversion_mv`, `instant_forex_events_segment_success_mv`
