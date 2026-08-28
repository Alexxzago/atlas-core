# EPIC 044 - Voice AI Architecture Freeze

**Status:** Frozen
**Authority:** Implementation contract for EPIC 044 PASS 1
**Provider feasibility:** Unavailable

## Scope

EPIC 044 adds an asynchronous Voice AI modality to existing WhatsApp conversations. Voice is not a new conversation channel, assistant runtime, authority model, or event feed.

In scope:

- WhatsApp inbound audio.
- Asynchronous speech-to-text (STT).
- The existing operational Assistant runtime, Conversation Intelligence, tools, and authority fence.
- `text_only` and `voice_with_text_fallback` reply policies.
- Text-to-speech (TTS), WhatsApp outbound audio, and safe operator playback/status.
- One Voice policy per WhatsApp connection.
- Existing `conversation_events.sequence` feed synchronization.

Out of scope:

- Browser microphone, browser STT/TTS, and Web Chat audio.
- Realtime streaming, barge-in, playback-state streaming, PSTN, SIP, and DTMF.
- Configurable legal retention/consent and billing/pricing.

## Inbound Execution Gate

EPIC 044 uses Model A. WhatsApp audio capture creates the existing channel execution request with `state=pending` and `media_gate_state=blocked_by_media`.

- Successful media association creates durable transcription work and changes the execution request to `blocked_by_transcript`.
- `blocked_by_media` and `blocked_by_transcript` are never leaseable.
- Successful transcript completion opens the existing request only when the captured work remains eligible under automated authority.
- The audio placeholder is never semantic runtime input.
- Authority or Voice-policy suppression is terminal `state=completed`, `outcome=suppressed`; it is not retried, is not a provider failure, creates no safe fallback, and is not reopened by release or resolve.
- Unsupported, malformed, truncated, duration-invalid, or non-processable voice input is terminal `state=unsupported`, `outcome=unsupported`.

## Canonical Transcript

- The existing inbound `conversation_message` remains immutable provider-event and replay evidence.
- A new immutable transcript record is canonical semantic content for an inbound audio message.
- No second customer message is created.
- The runtime and Conversation Intelligence resolve transcript content by the original message ID.
- Standard text-message behavior remains unchanged.
- Migration 0060 makes `conversation_messages` append-only with update/delete rejection triggers.

## Reserved Outbound Ordering

For `voice_with_text_fallback`, assistant finalization creates one durable outbound-delivery reservation immediately:

```text
state=blocked_by_synthesis
payload_kind=deferred_voice
response_policy=deferred_voice
```

- This same delivery row reserves per-conversation order using the existing durable delivery `rowid` ordering.
- A later same-conversation response cannot lease ahead of this reservation.
- Synthesis success changes the same row to `payload_kind=audio`, `state=pending`.
- Terminal synthesis failure changes the same row to `payload_kind=text`, `state=pending`.
- Authority loss before external send changes the same row to terminal `state=suppressed`.
- Replay reuses the same response, synthesis request, and delivery reservation; it never creates a second slot.
- Text and Voice responses share one ordering stream.

## Deferred Voice Semantic Visibility

Semantic visibility gating applies only to generated assistant responses with durable `response_policy=deferred_voice`.

- Pre-0060 assistant text, standard WhatsApp text-only responses, Web Chat responses, and operator messages retain their current semantic behavior.
- No semantic visibility backfill is performed.
- A deferred Voice response is excluded while blocked, suppressed, permanently pre-send failed, or uncertain.
- A deferred Voice response becomes visible at `externally_committed`: provider acceptance is durably recorded with an external message ID and delivery `state=accepted`.
- `externally_committed` does not mean recipient delivered, heard, read, or customer-observed.
- `uncertain` remains excluded.
- A new append-only `voice_response_visibility` record exists only for deferred Voice responses and records `kind=externally_committed` without provider payload, recipient identity, phone number, media ID, URL, or credential.
- Conversation Intelligence applies deferred assistant output exactly once after this visibility record exists. Standard assistant output remains immediately applied.

## Authority Through Dispatch

The runtime authority generation is persisted on both the synthesis request and the reserved Voice delivery.

It is checked before:

1. synthesis provider invocation;
2. synthesis settlement; and
3. external WhatsApp send for either audio or text fallback.

Every check requires an open conversation, `automated` control state, and an equal authority generation. Lost authority terminally suppresses the reservation without an external call or provider-failure classification. Release and resolve never reactivate suppressed work.

## Voice Policy

Migration 0060 adds one provider-neutral Voice policy per WhatsApp connection:

```text
voiceAiEnabled
audioResponseMode=text_only|voice_with_text_fallback
version
```

- Reads require `company:read`.
- Mutations require `company:manage`, use optimistic `expectedVersion`, and use a durable `operationId` replay ledger.
- Browser clients never receive or provide provider credentials or secrets.
- Readiness is server-derived: `unavailable | disabled | ready | degraded`.

### Voice Policy HTTP Contract

```text
GET /workspaces/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId/voice-policy
PUT /workspaces/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId/voice-policy
```

The PUT body is exact:

```json
{
  "expectedVersion": 1,
  "operationId": "voice-policy-operation-id",
  "voiceAiEnabled": true,
  "audioResponseMode": "voice_with_text_fallback"
}
```

All protected outcomes retain `Cache-Control: no-store, private` and `Pragma: no-cache`.

| Condition | Status | Response convention |
|---|---:|---|
| GET success | 200 | Safe policy/readiness projection. |
| PUT applied | 200 | Stored policy/readiness projection. |
| PUT matching replay of applied operation | 200 | Original stored projection. |
| PUT stale version | 409 | Conflict outcome. |
| PUT matching replay of stored stale operation | 409 | Original stored conflict outcome. |
| PUT divergent operation ID reuse | 409 | Conflict outcome. |
| Invalid body, unknown field, invalid version, invalid operation ID | 400 | Existing validation-error convention. |
| Oversized JSON | 413 | Existing `knowledge_input_too_large` envelope. |
| Missing or foreign Company/connection | 404 | Existing generic resource-not-found envelope. |
| Invalid session, inactive user/membership, missing permission, invalid Origin, Fetch Metadata, or CSRF | 404 | Existing generic resource-not-found envelope. |

## Event Feed

- `conversation_events.sequence` remains the only incremental synchronization order.
- Migration 0060 adds only metadata-safe `voice_state_changed`.
- `voice_state_changed` requires `related_message_id`.
- It never carries transcript, audio, provider, media, URL, credential, or payload data.
- The frontend continues to reload authoritative data through the existing cursor/feed model; it receives no second cursor or sequence.

## Duration Inspection

- Voice-processable formats are Ogg Opus and WAV PCM.
- MP3 may remain stored by Media Core but is unsupported for Voice AI processing.
- Duration is derived locally from bounded audio bytes before STT. It is never supplied by Meta or an STT provider.
- No ffmpeg, ffprobe, MediaInfo, external binary, or transcoding is introduced.
- Malformed, truncated, unsupported, or over-limit input never reaches STT.

## Audio Upload and Send Recovery

- Generated audio is a private local media asset.
- WhatsApp media upload may persist a bounded internal provider-media ID for recovery.
- Provider-media IDs are never credentials, URLs, public DTO data, feed data, or logs.
- A durable send-start marker is written before external send.
- Timeout or process loss after send-start becomes `uncertain` and is not auto-resent.
- Existing delivery callbacks reconcile where provider evidence permits.

## Provider Feasibility Result

| Requirement | Result |
|---|---|
| Installed Gemini SDK | `@google/genai` 2.11.0 is installed. Atlas uses it for text generation through `GoogleGenAI` and `GEMINI_API_KEY`. |
| STT provider | Unavailable. No installed or configured adapter is proven to perform bounded server-side STT for Ogg Opus and WAV PCM. |
| TTS provider | Unavailable. No installed or configured adapter is proven to synthesize WhatsApp-compatible Ogg Opus. |
| Credential source | Unavailable for Voice. Existing `WhatsAppCredentialResolver` resolves Meta credentials only. `GEMINI_API_KEY` is a server-side text-provider credential but does not prove Voice entitlement or APIs. |
| Input codecs | Required by this freeze: Ogg Opus and WAV PCM. Existing Media Core stores `audio/ogg` and `audio/wav`; no STT adapter is proven. |
| Output codec | Required by this freeze: direct `audio/ogg` Opus. No provider is proven to produce it. |
| Maximum input size | Existing Media Core limit is 25 MiB. No provider-specific accepted input limit is proven. |
| Maximum input duration | Unavailable until the bounded local duration inspector and a concrete provider limit are approved. |
| Maximum output size/duration | Unavailable; no TTS provider is proven. |
| Timeout | Unavailable; no STT/TTS adapter contract exists. |
| Abort support | SDK declarations expose abort support for current Gemini generation calls, but no Voice API operation is proven. |
| WhatsApp-compatible Ogg Opus output | Unavailable; no concrete provider/API/model/output contract is proven. |
| Fixed-HTTPS adapter boundary | Architecturally feasible behind future provider-neutral STT/TTS ports, following existing bounded provider adapter patterns. No adapter is implemented or selected. |

**Decision:** `UNAVAILABLE`.

Until a later explicit feasibility review proves a concrete server-side STT and TTS provider, Voice policy defaults to `voiceAiEnabled=false`, readiness is `unavailable`, and PASS 3/PASS 5 cannot be declared production-ready. SDK method names or type declarations alone are insufficient evidence.

## Migration 0060 Contract

PASS 2, not PASS 1, will add:

```text
whatsapp_voice_policies
whatsapp_voice_policy_operations
conversation_audio_transcripts
audio_transcription_requests
voice_synthesis_requests
whatsapp_outbound_media_uploads
voice_response_visibility
```

PASS 2 will perform controlled changes/rebuilds for:

```text
channel_execution_requests
outbound_deliveries
conversation_messages immutability triggers
conversation_events for voice_state_changed
```

Requirements for that migration:

- Migration 59 remains unchanged.
- Existing delivery rowids and ordering are preserved.
- Existing event sequences and AUTOINCREMENT high-watermark are preserved.
- Indexes, triggers, foreign keys, and append-only guarantees are recreated and revalidated.
- Existing delivery rows become standard text behavior.
- No semantic visibility backfill is performed.

## Boundaries

- Controllers translate HTTP only.
- Services own Voice policy, authority, and workflow rules.
- Repositories are the only SQLite boundary.
- Provider calls never occur inside database transactions.
- Provider-specific types remain behind future provider-neutral ports.
- PASS 1 introduces no migration, repository, service, worker, provider adapter, controller, route, frontend, delivery lifecycle, or database-table implementation.
