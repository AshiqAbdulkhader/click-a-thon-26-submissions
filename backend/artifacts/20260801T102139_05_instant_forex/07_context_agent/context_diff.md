# Context Diff

## Added Feature

- Feature: Instant Forex Add-on
- Slug: `instant_forex`
- Table: `silver.instant_forex_events`
- Primary entity: `application_id`
- Workflow type: `revenue_addon`
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

- Primary entity is application_id; events form a revenue add‑on funnel; success event is forex_purchased; metrics focus on attach rate, AOV uplift, drop‑off points, and segment analysis.

## Registry Status

- Known generated features: 3
- Known context contradictions: 2
