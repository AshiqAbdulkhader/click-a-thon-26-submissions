# Context Diff

## Added Feature

- Feature: Visa Status Sharing
- Slug: `status_sharing`
- Table: `silver.status_sharing_events`
- Primary entity: `share_id`
- Workflow type: `referral_loop`
- Events: `share_clicked` -> `channel_selected` -> `link_generated` -> `link_opened` -> `recipient_cta_clicked`
- Success event: `recipient_cta_clicked`

## Metric Hints

- share_rate_by_status_shared
- channel_mix_by_share
- new_user_link_opens_by_channel
- k_factor_recipient_conversion

## Context Notes

- Sharer events carry full envelope; recipient events keyed by share_id
- Event order reflects user journey from share to recipient conversion
- Primary entity is share_id linking sharer and recipient events

## Registry Status

- Known generated features: 2
- Known context contradictions: 2
