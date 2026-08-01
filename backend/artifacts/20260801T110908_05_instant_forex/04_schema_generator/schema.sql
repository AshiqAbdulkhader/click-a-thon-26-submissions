CREATE TABLE IF NOT EXISTS silver.instant_forex_events
(
    job_id String,
    event_name LowCardinality(String),
    event_id String,
    timestamp DateTime64(3),
    addon_value_inr Nullable(Float64),
    amount Nullable(Float64),
    app_version LowCardinality(String),
    application_id String,
    city LowCardinality(String),
    client_lib LowCardinality(String),
    destination LowCardinality(String),
    device_type LowCardinality(String),
    from_currency LowCardinality(String),
    fx_rate Nullable(Float64),
    geoip_country_code LowCardinality(String),
    os Nullable(LowCardinality(String)),
    to_currency LowCardinality(String),
    user_id String,
    raw_json String,
    ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_name, timestamp, application_id, user_id, event_id)
TTL timestamp + INTERVAL 18 MONTH;
