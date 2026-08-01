CREATE TABLE IF NOT EXISTS silver.abandoned_checkout_recovery_events
(
    job_id String,
    event_name LowCardinality(String),
    event_id String,
    timestamp DateTime64(3),
    app_version LowCardinality(String),
    application_id String,
    channel Nullable(LowCardinality(String)),
    city LowCardinality(String),
    client_lib LowCardinality(String),
    destination LowCardinality(String),
    device_type LowCardinality(String),
    drop_step LowCardinality(String),
    geoip_country_code LowCardinality(String),
    hours_since_drop Nullable(UInt8),
    os Nullable(LowCardinality(String)),
    user_id String,
    raw_json String,
    ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_name, timestamp, application_id, user_id, event_id)
TTL timestamp + INTERVAL 18 MONTH;
