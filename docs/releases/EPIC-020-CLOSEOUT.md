# EPIC-020 Closeout Report

## Objective

Validate Atlas's production WhatsApp flow against the Meta WhatsApp Cloud API: configure a tenant connection, validate credentials and webhooks, receive and persist inbound messages, generate and send AI replies, persist delivery lifecycle events, and expose safe operational state.

## Implemented Milestones

- Tenant-scoped WhatsApp connection configuration, encrypted credentials, provider identity validation, activation gates, and health state.
- Signed raw-body Meta webhook verification and subscription challenge handling.
- WhatsApp conversation binding, inbound message persistence, AI turn execution, and human-handoff control behavior.
- Persisted outbound provider-message records and delivery lifecycle state: pending, leased, accepted, delivered, read, retryable, permanent failure, and uncertain.
- Safe delivery-status processing for Meta sent, delivered, read, and failed callbacks.
- Read-only authenticated conversation inbox and detail projections with sanitized outbound delivery state.
- Durable outbound queueing, lease dispatch, restart recovery for pending/retryable/expired-lease deliveries, and shutdown-safe worker scheduling.
- Atomic inbound event capture and automatic restart recovery from persisted inbound messages without relying on Meta webhook redelivery.

## Final Architecture Summary

Atlas retains the approved dependency direction:

```text
Webhook controller -> WhatsApp services -> repositories -> SQLite
                                      -> Meta Cloud API provider
```

- Controllers remain HTTP-only.
- Services coordinate connection lifecycle, inbound recovery, assistant execution, outbound queueing, and dispatch.
- Repositories remain the only SQLite access layer.
- The Meta provider remains responsible only for Cloud API calls.
- No endpoint, database migration, persistence model, or standalone domain abstraction was added for resiliency.

Inbound processing now durably captures the provider event, inbound conversation message, provider message record, and their relationships before AI work begins. Restart recovery resumes incomplete linked events using the persisted inbound message and a deterministic reply idempotency key.

Outbound messages are persisted as pending deliveries before Meta is called. A periodic dispatcher leases due work, sends through Meta, records the returned `wamid`, and marks the row accepted. Expired leases are reclaimed after restart. Ambiguous provider send failures become `uncertain` and are not retried automatically.

## Test Summary

Automated verification passed:

- `npm run typecheck`
- `npm run test:epic020`
- `npm test`

Final result: 206 passing tests in the full backend suite.

Coverage includes:

- Meta signature verification and webhook parsing.
- Credential validation, activation gates, and safe redaction.
- Atomic inbound provider-event capture.
- Conversation control and duplicate inbound protection.
- Durable outbound queueing and lifecycle transitions.
- Safe delivery-status processing.
- Read-only conversation delivery projections without provider IDs, connection IDs, credentials, or raw Meta identifiers.

## Manual Production Validation Summary

The automated suite validates Atlas behavior against provider contracts and local persistence. A real Meta production validation remains a release-operation activity and must be recorded with redacted evidence.

Required production evidence:

- Meta webhook subscription challenge succeeds for `GET /webhooks/whatsapp`.
- A real WABA, Phone Number ID, and system-user token validate successfully.
- A real customer text reaches Atlas through a signed webhook.
- Atlas persists one inbound message and one tenant-scoped conversation binding.
- Atlas generates and queues one AI reply.
- Meta accepts the reply and returns a `wamid`.
- Meta delivery callbacks advance the lifecycle through accepted, delivered, and read when receipts are available.
- Consecutive messages continue in the same conversation.
- Concurrent customers create isolated conversations without cross-tenant or cross-customer leakage.
- Restart Atlas while a captured inbound event and while a leased outbound delivery exist; confirm automatic recovery without Meta redelivery or duplicate customer messages.

## Known Limitations

- Meta text sends are intentionally limited to supported free-form text behavior. Templates, media, interactive messages, and other payload types are not part of EPIC-020.
- An ambiguous Meta send failure is retained as `uncertain`; Atlas does not automatically resend it because the provider outcome may already have reached the customer.
- Pre-existing historical provider events that were persisted before EPIC-020 with no linked inbound message cannot be replayed automatically. New events are captured atomically and are recoverable.
- Conversation turn locking is process-local. Multi-instance deployment requires operational care until distributed turn coordination is separately planned.

## Risks

- A process failure after Meta accepts a request but before Atlas persists the returned `wamid` leaves delivery state uncertain. Automatic retry would risk duplicate delivery, so it is intentionally excluded.
- Delayed or missing Meta delivery callbacks can leave an accepted delivery without a later delivered/read state even when the message reached the customer.
- Production validation depends on Meta app permissions, WABA setup, callback reachability, TLS, and recipient eligibility outside Atlas's control.
- A provider outage can delay pending/retryable deliveries until the dispatcher obtains a successful pre-send attempt.

## Future Improvements

Explicitly out of scope for EPIC-020:

- Meta template, media, interactive, and conversation-window support.
- Distributed conversation turn locking for multi-instance workers.
- Provider-side message reconciliation for uncertain sends.
- Delivery monitoring, alerting, dashboards, and operational metrics.
- Configurable retry policy and dead-letter operations.
- Additional communication channels.

## Final Definition Of Done Checklist

- [x] WhatsApp connection configuration is tenant-scoped and credentials are encrypted at rest.
- [x] Credential validation, published knowledge, and executable assistant profile are required before activation.
- [x] Generic production activation bypass is blocked.
- [x] Meta webhook verification and exact raw-body HMAC validation are implemented.
- [x] Inbound customer messages persist with tenant-scoped conversation bindings.
- [x] AI responses persist before outbound delivery is attempted.
- [x] Outbound delivery lifecycle is persisted and Meta status callbacks update it safely.
- [x] Operational reads expose projections only, never domain entities or secrets.
- [x] Pending, retryable, and expired leased deliveries recover through durable dispatch.
- [x] Incomplete captured inbound events recover after process interruption without Meta redelivery.
- [x] Type checking and the complete automated test suite pass.
- [ ] Real Meta production validation is executed and redacted evidence is attached to the release record.

EPIC-020 code scope is complete. Final production release approval requires completion of the unchecked real-Meta validation item.

## Release Notes

- Added production-ready WhatsApp delivery resiliency using existing persistence and domain boundaries.
- Added restart-safe inbound processing and outbound lease dispatch.
- Added safe operational conversation read projections with delivery lifecycle visibility.
- Strengthened WhatsApp activation and operational health behavior.
- Added EPIC-020 verification coverage to the default backend test workflow.
