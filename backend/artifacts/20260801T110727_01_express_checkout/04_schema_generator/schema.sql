CREATE TABLE IF NOT EXISTS silver.express_checkout_events
(
    job_id String,
    event_name LowCardinality(String),
    event_id String,
    timestamp DateTime64(3),
    app_version LowCardinality(String),
    application_id String,
    city LowCardinality(String),
    client_lib LowCardinality(String),
    currency Nullable(LowCardinality(String)),
    destination LowCardinality(String),
    device_type LowCardinality(String),
    eligible Nullable(Bool),
    geoip_country_code LowCardinality(String),
    os Nullable(LowCardinality(String)),
    otp_attempts Nullable(UInt8),
    otp_success Nullable(Bool),
    payment_amount Nullable(Float64),
    payment_currency Nullable(LowCardinality(String)),
    payment_latency_ms Nullable(UInt32),
    saved_method_type Nullable(LowCardinality(String)),
    shown_amount Nullable(Float64),
    user_id String,
    raw_json String,
    ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_name, timestamp, application_id, user_id, event_id)
TTL timestamp + INTERVAL 18 MONTH;
