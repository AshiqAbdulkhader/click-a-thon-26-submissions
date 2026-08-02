CREATE TABLE IF NOT EXISTS silver.express_checkout_events
(
    event_name LowCardinality(String),
    event_id String,
    timestamp DateTime64(3),
    ingested_at DateTime DEFAULT now(),
    job_id String,
    app_version LowCardinality(String),
    application_id String,
    city LowCardinality(String),
    client_lib LowCardinality(String),
    currency Nullable(String),
    destination LowCardinality(String),
    device_type LowCardinality(String),
    eligible Nullable(Bool),
    geoip_country_code LowCardinality(String),
    os Nullable(String),
    otp_attempts Nullable(UInt8),
    otp_success Nullable(Bool),
    payment_amount Nullable(Float64),
    payment_currency Nullable(String),
    payment_latency_ms Nullable(UInt32),
    saved_method_type Nullable(String),
    shown_amount Nullable(Float64),
    user_id String,
    device LowCardinality(String),
    geo LowCardinality(String),
    saved_method Nullable(String),
    raw_json String
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, event_id)
TTL timestamp + INTERVAL 18 MONTH;
