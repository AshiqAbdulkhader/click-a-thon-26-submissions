# Schema Review

## Verdict

Pass for v0 instrumentation.

## What this schema optimizes for

- Feature workflow: `funnel`
- Primary entity: `application_id`
- Success event: `forex_purchased`
- Partitioning: `toYYYYMM(timestamp)`
- Ordering key: `(event_name, timestamp, application_id, user_id, event_id)`

## Checks

- No blocking issues found.

## Notes

- Raw payload is preserved in `raw_json` for replay and hidden-spec debugging.
- `ReplacingMergeTree` is used so repeated `event_id` values can collapse during merges.
- TTL is set to `timestamp + INTERVAL 18 MONTH`; adjust if judges ask for longer retention.
