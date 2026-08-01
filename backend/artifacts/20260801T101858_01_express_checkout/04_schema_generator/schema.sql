CREATE TABLE IF NOT EXISTS silver.express_checkout_events
(
    job_id String,
    event_name LowCardinality(String),
    event_id String,
    timestamp DateTime64(3),
    app_version LowCardinality(String),
    application_id LowCardinality(String),
    city LowCardinality(String),
    client_lib LowCardinality(String),
    currency LowCardinality(String),
    destination LowCardinality(String),
    device_type LowCardinality(String),
    eligible Bool,
    geoip_country_code LowCardinality(String),
    os Nullable(LowCardinality(String)),
    otp_attempts UInt8,
    otp_success Bool,
    payment_amount UInt16,
    payment_currency LowCardinality(String),
    payment_latency_ms UInt16,
    saved_method_type LowCardinality(String),
    shown_amount UInt16,
    user_id LowCardinality(String),
    raw_json String,
    ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_name, timestamp, application_id, user_id, event_id)
TTL timestamp + INTERVAL 18 MONTH;
