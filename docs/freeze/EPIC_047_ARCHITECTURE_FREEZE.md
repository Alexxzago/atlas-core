# EPIC 047 Architecture Freeze

**Status:** Frozen for PASS1. This freeze authorizes no PASS2 implementation.

- Atlas remains a modular monolith. Turso/libSQL remains the production relational authority.
- Durable workers remain database-backed. Redis, Kafka, and RabbitMQ are not introduced.
- Voice real-provider activation is deferred; Voice remains intentionally unavailable where no provider exists.
- Optional provider unavailability does not fail global readiness or unrelated startup.
- `ATLAS_MEDIA_ROOT` satisfies only the current `LocalMediaStorage` runtime dependency. Local media is development/test or temporary pre-hardening storage, not durable production media. R2/S3-compatible durable media is reserved for PASS6 and is not implemented here.
- Abuse controls remain separate from Billing entitlements and security authorization.
- `0069` is provisional and is not created in PASS1. Published migrations are immutable.
- Health/readiness implementation belongs to PASS3; observability belongs to PASS2; Stripe webhook correction belongs to PASS4.
- EPIC048 is not started by EPIC047.

## Client Address Boundary

Vercel may rewrite `/api` to Render, while the Render service can also be reached directly. The available topology does not prove a spoof-safe original-client address across both paths. Atlas therefore trusts no forwarded address header: `req.ip` is the connected peer only and is non-authoritative as a client-origin discriminator. Login throttling stores a composite normalized-identity and origin key, so a shared proxy peer cannot create a cross-identity/global bucket. Durable IP rate limits remain blocked until PASS5 establishes a verified ingress contract.
