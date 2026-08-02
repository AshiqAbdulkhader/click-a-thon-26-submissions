CREATE TABLE IF NOT EXISTS gold.instant_forex_events_daily_event_counts
(
    event_date Date,
    event_name LowCardinality(String),
    device_type String,
    os String,
    geoip_country_code String,
    destination String,
    events UInt64,
    unique_users UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_name, device_type, os, geoip_country_code, destination);

CREATE MATERIALIZED VIEW IF NOT EXISTS gold.instant_forex_events_daily_event_counts_mv
TO gold.instant_forex_events_daily_event_counts
AS
SELECT
    toDate(timestamp) AS event_date,
    event_name,
    toString(ifNull(device_type, '')) AS device_type,
    toString(ifNull(os, '')) AS os,
    toString(ifNull(geoip_country_code, '')) AS geoip_country_code,
    toString(ifNull(destination, '')) AS destination,
    count() AS events,
    uniq(user_id) AS unique_users
FROM silver.instant_forex_events
GROUP BY event_date, event_name, device_type, os, geoip_country_code, destination;

CREATE TABLE IF NOT EXISTS gold.instant_forex_events_daily_conversion
(
    event_date Date,
    started_entities UInt64,
    success_entities UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date);

CREATE MATERIALIZED VIEW IF NOT EXISTS gold.instant_forex_events_daily_conversion_mv
TO gold.instant_forex_events_daily_conversion
AS
SELECT
    toDate(timestamp) AS event_date,
    uniqExactIf(application_id, event_name = 'forex_offer_shown') AS started_entities,
    uniqExactIf(application_id, event_name = 'forex_purchased') AS success_entities
FROM silver.instant_forex_events
GROUP BY event_date;

CREATE TABLE IF NOT EXISTS gold.instant_forex_events_segment_success
(
    device_type String,
    os String,
    geoip_country_code String,
    destination String,
    entities UInt64,
    success_entities UInt64
)
ENGINE = SummingMergeTree
ORDER BY (device_type, os, geoip_country_code, destination);

CREATE MATERIALIZED VIEW IF NOT EXISTS gold.instant_forex_events_segment_success_mv
TO gold.instant_forex_events_segment_success
AS
SELECT
    toString(ifNull(device_type, '')) AS device_type,
    toString(ifNull(os, '')) AS os,
    toString(ifNull(geoip_country_code, '')) AS geoip_country_code,
    toString(ifNull(destination, '')) AS destination,
    uniqExact(application_id) AS entities,
    uniqExactIf(application_id, event_name = 'forex_purchased') AS success_entities
FROM silver.instant_forex_events
GROUP BY device_type, os, geoip_country_code, destination;
