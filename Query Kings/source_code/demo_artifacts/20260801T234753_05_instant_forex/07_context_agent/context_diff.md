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

- attach_rate_overall_and_by_destination
- aov_uplift_distribution_of_addon_value_inr
- drop_points_offer_to_amount_entered_and_added_to_cart_to_purchased
- best_attach_destinations_and_currencies_by_segment

## Context Notes

- addon_value_inr only in forex_added_to_cart and forex_purchased
- fx_rate only in forex_offer_shown
- currency fields present only in offer_shown
- all events share application_id, user_id, device_type, geoip_country_code, destination

## Registry Status

- Known generated features: 5
- Known columns: 379
- Known workflows: 6
- Known metrics: 28
- Known joins: 100
- Known context contradictions / gaps / known-issue links: 9

## Open Contradictions & Gaps (sample)

- `base_context_eta_name_mismatch`: Base context mentions visa_issuance_eta_days, while the loaded application_started DDL exposes eta_shown.
- `conversion_denominator_ambiguity`: Base context defines leadership conversion as purchases divided by sessions, but funnel conversion as purchases divided by application_started users.
- `gap:instant_forex:orphan_metric_best_attach_destinations_and_currencies_by_segment`: Metric hint "best_attach_destinations_and_currencies_by_segment" does not clearly map to any generated column name; analytics should treat the formula as approximate.
- `known_issue_link:abandoned_checkout_recovery:k1_ios_webkit_otp`: Feature abandoned_checkout_recovery touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:abandoned_checkout_recovery:k5_whatsapp_nudge`: Feature abandoned_checkout_recovery relates to recovery/re-engagement. Context notes K5 WhatsApp nudge can lift returns for previously dropped users — separate campaign lift from product changes.
- `known_issue_link:express_checkout:k1_ios_webkit_otp`: Feature express_checkout touches payment/OTP/checkout flows. Analytics should cut by iOS/device and check against known issue K1 (iOS WebKit OTP autofill regression).
- `known_issue_link:express_checkout:k6_summer20`: Feature express_checkout may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
- `known_issue_link:group_family:k2_k3_passport`: Feature group_family relates to document/passport capture. Watch K2 (Android capture failures after model update) and K3 (non-Latin MRZ OCR retries).
- `known_issue_link:instant_forex:k6_summer20`: Feature instant_forex may interact with promo/currency behaviour. K6 SUMMER20 campaign elevates coupon_applied and can lower realised value — do not treat value drops as pure product regressions without checking coupons.
