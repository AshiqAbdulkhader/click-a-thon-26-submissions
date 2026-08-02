CREATE TABLE IF NOT EXISTS silver.express_checkout_events
(
    event_name LowCardinality(String),
    event_id String,
    timestamp DateTime64(3),
    ingested_at DateTime DEFAULT now(),
    application_id String,
    user_id String,
    device_type LowCardinality(String),
    os Nullable(String),
    geoip_country_code LowCardinality(String),
    destination String,
    client_lib LowCardinality(String),
    app_version LowCardinality(String),
    eligible Nullable(Bool),
    shown_amount Nullable(Float64),
    payment_amount Nullable(Float64),
    payment_currency Nullable(String),
    payment_latency_ms Nullable(UInt32),
    otp_attempts Nullable(UInt8),
    otp_success Nullable(Bool),
    saved_method_type Nullable(String),
    job_id String,
    city LowCardinality(String),
    currency Nullable(String),
    raw_json String
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, event_id)
TTL timestamp + INTERVAL 18 MONTH;
