CREATE TABLE IF NOT EXISTS silver.status_sharing_events
(
    job_id String,
    event_name LowCardinality(String),
    event_id String,
    timestamp DateTime64(3),
    app_version Nullable(LowCardinality(String)),
    application_id Nullable(String),
    channel Nullable(LowCardinality(String)),
    city Nullable(LowCardinality(String)),
    client_lib Nullable(LowCardinality(String)),
    cta Nullable(LowCardinality(String)),
    destination LowCardinality(String),
    device_type Nullable(LowCardinality(String)),
    geoip_country_code Nullable(LowCardinality(String)),
    os Nullable(LowCardinality(String)),
    recipient_is_new_user Nullable(Bool),
    share_id String,
    status_shared Nullable(LowCardinality(String)),
    user_id Nullable(String),
    raw_json String,
    ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_name, timestamp, share_id, user_id, event_id)
TTL timestamp + INTERVAL 18 MONTH;
