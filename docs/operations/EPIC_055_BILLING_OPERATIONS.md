# EPIC055 Billing Operations

## Canonical State

Billing subscriptions and entitlements are updated only by reconciliation. Webhook receipt and checkout returns are signals that enqueue durable work; neither confirms payment nor grants access.

To investigate an incident, use the customer billing projection and the provider dashboard to compare the trusted provider subscription with the canonical Atlas state. Use safe operation IDs, reconciliation run IDs, and normalized failure categories from logs. Do not place provider payloads, payment data, or credentials in tickets or logs.

## Pending And Uncertain Operations

An `uncertain` checkout or provider operation is deliberately not safe to retry manually. It has a durable operation ledger entry and provider idempotency/correlation evidence. Reconciliation and operation recovery run before normal reconciliation each runtime cycle and resume after restart.

Safe actions:

- Wait for the configured reconciliation retry window and refresh the canonical billing view.
- Inspect the matching Stripe or Mercado Pago sandbox/production dashboard using the safe operation correlation already recorded by Atlas.
- Restart a healthy Atlas process if the worker is unavailable; durable leases expire and pending work is reclaimed safely.

Do not create a replacement checkout, replay a provider request by hand, or update billing tables directly. Mercado Pago creates are especially not safe for blind retry after an uncertain outcome.

## Readiness And Outages

In production, `/ready` requires billing reconciliation to have completed a healthy cycle. Its billing worker stale threshold is the configured reconciliation interval plus the bounded provider request window. `/health` is process liveness only and does not validate billing dependencies.

Provider timeouts, network failures, and provider 5xx responses remain retryable/uncertain and preserve the current canonical entitlement. Persistent worker failures or a stale worker must be treated as an incident; `/ready` will not claim a healthy runtime in those conditions. Investigate overdue durable work and expired leases from the reconciliation ledger before escalating; normal retry backlog is not itself a readiness failure.

Check `BILLING_RECONCILIATION_INTERVAL_MS` and `BILLING_RECONCILIATION_BATCH_SIZE` before changing operational expectations. Retries use durable bounded backoff; do not add ad hoc sleep/retry loops.

## Restore Recovery

Backup restore preserves billing accounts, current subscriptions, checkout enrollments, operation and event ledgers, reconciliation work, payer bindings, and immutable catalog offers as database state. After restoring and promoting a backup, start Atlas normally and wait for `/ready`; the worker resumes due durable work without manual database mutation.
