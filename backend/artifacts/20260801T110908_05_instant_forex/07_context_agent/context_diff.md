# Context Diff

## Added Feature

- Feature: Instant Forex Add-on
- Slug: `instant_forex`
- Table: `silver.instant_forex_events`
- Primary entity: `application_id`
- Workflow type: `funnel`
- Events: `forex_offer_shown` -> `currency_selected` -> `amount_entered` -> `forex_added_to_cart` -> `forex_purchased`
- Success event: `forex_purchased`

## Metric Hints

- attach_rate_overall
- attach_rate_by_destination
- aov_uplift_distribution
- drop_off_offer_to_amount_entered
- drop_off_added_to_cart_to_purchased
- best_attach_destinations
- segment_skew_by_device_geo

## Context Notes

- Primary entity is application_id; events are part of a linear add‑on funnel; success is forex_purchased; metrics focus on attach rates, AOV uplift, drop‑off points, and segment skew.

## Registry Status

- Known generated features: 5
- Known context contradictions: 2
