import { createHash } from "node:crypto";
import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type {
  TranscriptionFinalization,
  TranscriptionFinalizationResult,
  VoiceLease,
  VoicePolicyMutation,
  VoicePolicyMutationResult,
  VoiceRepositoryPort,
  VoiceWorkSettlement,
} from "../whatsapp/application/voicePorts.js";
import {
  voiceBounded,
  voiceDigest,
  voiceMode,
  voicePositive,
  voiceTimestamp,
  type AudioTranscriptionRequest,
  type ConversationAudioTranscript,
  type VoiceResponseVisibility,
  type VoiceSynthesisRequest,
  type VoiceWorkState,
  type WhatsAppOutboundMediaUpload,
  type WhatsAppVoicePolicy,
  type VoiceMessageReadModel,
  type VoicePlayback,
} from "../whatsapp/domain/voice.js";

type PolicyRow = {
  workspace_id: number;
  company_id: number;
  whatsapp_connection_id: string;
  voice_ai_enabled: number;
  audio_response_mode: "text_only" | "voice_with_text_fallback";
  version: number;
  created_at: string;
  updated_at: string;
};
type TranscriptRow = {
  id: string;
  workspace_id: number;
  company_id: number;
  conversation_id: string;
  conversation_message_id: string;
  media_asset_id: string;
  normalized_transcript: string;
  language_tag: string | null;
  input_digest: string;
  outcome: ConversationAudioTranscript["outcome"];
  safe_failure_category: string | null;
  created_at: string;
};
type WorkRow = {
  id: string;
  workspace_id: number;
  company_id: number;
  conversation_id: string;
  conversation_message_id: string;
  media_asset_id?: string;
  outbound_delivery_id?: string;
  state: VoiceWorkState;
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  expected_authority_generation: number;
  safe_outcome: string | null;
  safe_failure_category: string | null;
  rendition_settlement_id?: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
type UploadRow = {
  id: string;
  workspace_id: number;
  company_id: number;
  outbound_delivery_id: string;
  media_asset_id: string;
  provider_media_id: string | null;
  state: WhatsAppOutboundMediaUpload["state"];
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  safe_error_category: string | null;
  created_at: string;
  updated_at: string;
};
type VisibilityRow = {
  workspace_id: number;
  company_id: number;
  conversation_id: string;
  conversation_message_id: string;
  outbound_delivery_id: string;
  kind: "externally_committed";
  committed_at: string;
  created_at: string;
};
const policy = (r: PolicyRow): WhatsAppVoicePolicy =>
  Object.freeze({
    workspaceId: r.workspace_id,
    companyId: r.company_id,
    connectionId: r.whatsapp_connection_id,
    voiceAiEnabled: r.voice_ai_enabled === 1,
    audioResponseMode: r.audio_response_mode,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
const transcript = (r: TranscriptRow): ConversationAudioTranscript =>
  Object.freeze({
    id: r.id,
    workspaceId: r.workspace_id,
    companyId: r.company_id,
    conversationId: r.conversation_id,
    messageId: r.conversation_message_id,
    mediaAssetId: r.media_asset_id,
    normalizedTranscript: r.normalized_transcript,
    languageTag: r.language_tag,
    inputDigest: r.input_digest,
    outcome: r.outcome,
    safeFailureCategory: r.safe_failure_category,
    createdAt: r.created_at,
  });
const work = (r: WorkRow): AudioTranscriptionRequest | VoiceSynthesisRequest =>
  Object.freeze({
    id: r.id,
    workspaceId: r.workspace_id,
    companyId: r.company_id,
    conversationId: r.conversation_id,
    messageId: r.conversation_message_id,
    state: r.state,
    leaseOwner: r.lease_owner,
    leaseExpiresAt: r.lease_expires_at,
    attemptCount: r.attempt_count,
    expectedAuthorityGeneration: r.expected_authority_generation,
    safeOutcome: r.safe_outcome,
    safeFailureCategory: r.safe_failure_category,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    ...(r.media_asset_id === undefined
      ? {
          outboundDeliveryId: r.outbound_delivery_id!,
          renditionSettlementId: r.rendition_settlement_id ?? null,
        }
      : { mediaAssetId: r.media_asset_id }),
  });
const upload = (r: UploadRow): WhatsAppOutboundMediaUpload =>
  Object.freeze({
    id: r.id,
    workspaceId: r.workspace_id,
    companyId: r.company_id,
    outboundDeliveryId: r.outbound_delivery_id,
    mediaAssetId: r.media_asset_id,
    providerMediaId: r.provider_media_id,
    state: r.state,
    leaseOwner: r.lease_owner,
    leaseExpiresAt: r.lease_expires_at,
    attemptCount: r.attempt_count,
    safeErrorCategory: r.safe_error_category,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
const visibility = (r: VisibilityRow): VoiceResponseVisibility =>
  Object.freeze({
    workspaceId: r.workspace_id,
    companyId: r.company_id,
    conversationId: r.conversation_id,
    messageId: r.conversation_message_id,
    outboundDeliveryId: r.outbound_delivery_id,
    kind: r.kind,
    committedAt: r.committed_at,
    createdAt: r.created_at,
  });
const fingerprint = (v: VoicePolicyMutation): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        actorId: v.actorId,
        expectedVersion: v.expectedVersion,
        voiceAiEnabled: v.voiceAiEnabled,
        audioResponseMode: v.audioResponseMode,
      }),
    )
    .digest("hex");
const safe = (value: string | null, label: string): string | null =>
  value === null ? null : voiceBounded(value, label, 100);

export class WhatsAppVoiceRepository implements VoiceRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}
  public findPolicy(
    c: WorkspaceContext,
    companyId: number,
    connectionId: string,
  ): WhatsAppVoicePolicy | null {
    const r = this.db
      .prepare(
        "SELECT * FROM whatsapp_voice_policies WHERE workspace_id=? AND company_id=? AND whatsapp_connection_id=?",
      )
      .get(c.workspaceId, companyId, connectionId) as PolicyRow | undefined;
    return r ? policy(r) : null;
  }
  public applyPolicy(
    c: WorkspaceContext,
    companyId: number,
    connectionId: string,
    v: VoicePolicyMutation,
  ): VoicePolicyMutationResult {
    voiceBounded(v.actorId, "Voice actor", 128);
    voiceBounded(v.operationId, "Voice operation ID", 200);
    voicePositive(v.expectedVersion, "Voice expected version");
    voiceMode(v.audioResponseMode);
    voiceTimestamp(v.occurredAt);
    const digest = fingerprint(v);
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.findPolicy(c, companyId, connectionId);
      if (!current) {
        this.db.exec("COMMIT;");
        return { kind: "not_found" };
      }
      const previous = this.db
        .prepare(
          "SELECT request_fingerprint,outcome,resulting_voice_ai_enabled,resulting_audio_response_mode,resulting_version FROM whatsapp_voice_policy_operations WHERE workspace_id=? AND company_id=? AND whatsapp_connection_id=? AND operation_id=?",
        )
        .get(c.workspaceId, companyId, connectionId, v.operationId) as
        | {
            request_fingerprint: string;
            outcome: "applied" | "stale_version";
            resulting_voice_ai_enabled: number | null;
            resulting_audio_response_mode:
              PolicyRow["audio_response_mode"] | null;
            resulting_version: number | null;
          }
        | undefined;
      if (previous) {
        this.db.exec("COMMIT;");
        if (previous.request_fingerprint !== digest)
          return { kind: "replay_mismatch" };
        const snapshot =
          previous.resulting_version === null
            ? null
            : Object.freeze({
                ...current,
                voiceAiEnabled: previous.resulting_voice_ai_enabled === 1,
                audioResponseMode: previous.resulting_audio_response_mode!,
                version: previous.resulting_version,
              });
        return previous.outcome === "applied"
          ? { kind: "replayed_applied", policy: snapshot! }
          : { kind: "replayed_stale", policy: snapshot };
      }
      const stale = current.version !== v.expectedVersion;
      let saved = current;
      if (!stale) {
        const changed =
          this.db
            .prepare(
              "UPDATE whatsapp_voice_policies SET voice_ai_enabled=?,audio_response_mode=?,version=version+1,updated_at=? WHERE workspace_id=? AND company_id=? AND whatsapp_connection_id=? AND version=?",
            )
            .run(
              v.voiceAiEnabled ? 1 : 0,
              v.audioResponseMode,
              v.occurredAt,
              c.workspaceId,
              companyId,
              connectionId,
              v.expectedVersion,
            ).changes === 1;
        if (!changed) throw new Error("Voice policy CAS lost.");
        saved = this.findPolicy(c, companyId, connectionId)!;
      }
      this.db
        .prepare(
          "INSERT INTO whatsapp_voice_policy_operations(workspace_id,company_id,whatsapp_connection_id,operation_id,actor_user_id,request_fingerprint,expected_version,outcome,resulting_voice_ai_enabled,resulting_audio_response_mode,resulting_version,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          c.workspaceId,
          companyId,
          connectionId,
          v.operationId,
          v.actorId,
          digest,
          v.expectedVersion,
          stale ? "stale_version" : "applied",
          saved.voiceAiEnabled ? 1 : 0,
          saved.audioResponseMode,
          saved.version,
          v.occurredAt,
        );
      this.db.exec("COMMIT;");
      return stale
        ? { kind: "stale_version", policy: saved }
        : { kind: "applied", policy: saved };
    } catch (e) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw e;
    }
  }
  public createTranscript(
    c: WorkspaceContext,
    companyId: number,
    v: import("../whatsapp/application/voicePorts.js").TranscriptCreate,
  ): import("../whatsapp/application/voicePorts.js").TranscriptCreateResult {
    voiceBounded(v.id, "Transcript ID", 200);
    voiceBounded(v.normalizedTranscript, "Transcript", 16000);
    if (v.languageTag !== null) voiceBounded(v.languageTag, "Language tag", 35);
    voiceDigest(v.inputDigest);
    safe(v.safeFailureCategory, "Safe failure");
    voiceTimestamp(v.createdAt);
    const prior = this.findTranscriptByMessage(c, companyId, v.messageId);
    if (prior)
      return prior.mediaAssetId === v.mediaAssetId &&
        prior.normalizedTranscript === v.normalizedTranscript &&
        prior.languageTag === v.languageTag &&
        prior.inputDigest === v.inputDigest &&
        prior.outcome === v.outcome &&
        prior.safeFailureCategory === v.safeFailureCategory
        ? { kind: "replayed", transcript: prior }
        : { kind: "conflict" };
    try {
      const changed =
        this.db
          .prepare(
            "INSERT INTO conversation_audio_transcripts(id,workspace_id,company_id,conversation_id,conversation_message_id,media_asset_id,normalized_transcript,language_tag,input_digest,outcome,safe_failure_category,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            v.id,
            c.workspaceId,
            companyId,
            v.conversationId,
            v.messageId,
            v.mediaAssetId,
            v.normalizedTranscript,
            v.languageTag,
            v.inputDigest,
            v.outcome,
            v.safeFailureCategory,
            v.createdAt,
          ).changes === 1;
      if (!changed) return { kind: "not_found" };
      return {
        kind: "created",
        transcript: this.findTranscriptByMessage(c, companyId, v.messageId)!,
      };
    } catch {
      return { kind: "not_found" };
    }
  }
  public findTranscriptByMessage(
    c: WorkspaceContext,
    companyId: number,
    messageId: string,
  ): ConversationAudioTranscript | null {
    const r = this.db
      .prepare(
        "SELECT * FROM conversation_audio_transcripts WHERE workspace_id=? AND company_id=? AND conversation_message_id=?",
      )
      .get(c.workspaceId, companyId, messageId) as TranscriptRow | undefined;
    return r ? transcript(r) : null;
  }
  public isVoiceInboundMessage(
    c: WorkspaceContext,
    companyId: number,
    messageId: string,
  ): boolean {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM audio_transcription_requests WHERE workspace_id=? AND company_id=? AND conversation_message_id=?",
        )
        .get(c.workspaceId, companyId, messageId) !== undefined
    );
  }
  public isAssistantMessageSemanticallyVisible(
    c: WorkspaceContext,
    companyId: number,
    messageId: string,
  ): boolean {
    const rows = this.db
      .prepare(
        "SELECT d.id,d.response_policy FROM outbound_deliveries d JOIN provider_message_records r ON r.id=d.provider_message_record_id WHERE r.communication_channel='whatsapp' AND r.direction='outbound' AND r.conversation_message_id=?",
      )
      .all(messageId) as Array<{
      id: string;
      response_policy: "standard" | "deferred_voice";
    }>;
    return (
      rows.length === 0 ||
      rows.some(
        (row) =>
          row.response_policy !== "deferred_voice" ||
          this.db
            .prepare(
              "SELECT 1 FROM voice_response_visibility WHERE workspace_id=? AND company_id=? AND conversation_message_id=? AND outbound_delivery_id=? AND kind='externally_committed'",
            )
            .get(c.workspaceId, companyId, messageId, row.id) !== undefined,
      )
    );
  }
  public findCompletedInboundTranscriptMessages(
    c: WorkspaceContext,
    companyId: number,
    limit: number,
  ): readonly import("../conversation/domain/conversation.js").ConversationMessage[] {
    return this.findSemanticMessages(
      "SELECT m.id,m.conversation_id,m.sender_participant_id,m.direction,t.normalized_transcript AS content,m.idempotency_key,m.assistant_execution_record_id AS execution_record_id,m.created_at FROM conversation_audio_transcripts t JOIN conversation_messages m ON m.id=t.conversation_message_id JOIN conversations cn ON cn.id=m.conversation_id JOIN companies co ON co.id=cn.company_id WHERE t.workspace_id=? AND t.company_id=? AND t.outcome='completed' AND m.direction='inbound' AND co.workspace_id=? AND cn.company_id=? AND NOT EXISTS(SELECT 1 FROM conversation_intelligence_applied_messages a WHERE a.conversation_id=m.conversation_id AND a.conversation_message_id=m.id) ORDER BY t.created_at,t.id LIMIT ?",
      c,
      companyId,
      limit,
    );
  }
  public findVisibleDeferredAssistantMessages(
    c: WorkspaceContext,
    companyId: number,
    limit: number,
  ): readonly import("../conversation/domain/conversation.js").ConversationMessage[] {
    return this.findSemanticMessages(
      "SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id JOIN provider_message_records r ON r.conversation_message_id=m.id JOIN outbound_deliveries d ON d.provider_message_record_id=r.id JOIN voice_response_visibility v ON v.outbound_delivery_id=d.id AND v.conversation_message_id=m.id WHERE co.workspace_id=? AND c.company_id=? AND m.direction='outbound' AND r.communication_channel='whatsapp' AND r.direction='outbound' AND d.response_policy='deferred_voice' AND d.state IN ('accepted','delivered','read') AND v.kind='externally_committed' AND NOT EXISTS(SELECT 1 FROM conversation_intelligence_applied_messages a WHERE a.conversation_id=m.conversation_id AND a.conversation_message_id=m.id) ORDER BY m.created_at,m.id LIMIT ?",
      c,
      companyId,
      limit,
      false,
    );
  }
  public recoverableSemanticScopes(
    limit: number,
  ): readonly { readonly workspaceId: number; readonly companyId: number }[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    return Object.freeze(
      (
        this.db
          .prepare(
            "SELECT workspace_id,company_id FROM (SELECT t.workspace_id,t.company_id,t.created_at FROM conversation_audio_transcripts t JOIN conversation_messages m ON m.id=t.conversation_message_id WHERE t.outcome='completed' AND NOT EXISTS(SELECT 1 FROM conversation_intelligence_applied_messages a WHERE a.conversation_id=m.conversation_id AND a.conversation_message_id=m.id) UNION ALL SELECT v.workspace_id,v.company_id,v.created_at FROM voice_response_visibility v JOIN conversation_messages m ON m.id=v.conversation_message_id JOIN provider_message_records r ON r.conversation_message_id=m.id JOIN outbound_deliveries d ON d.id=v.outbound_delivery_id WHERE r.communication_channel='whatsapp' AND r.direction='outbound' AND d.response_policy='deferred_voice' AND d.state IN ('accepted','delivered','read') AND NOT EXISTS(SELECT 1 FROM conversation_intelligence_applied_messages a WHERE a.conversation_id=m.conversation_id AND a.conversation_message_id=m.id)) GROUP BY workspace_id,company_id ORDER BY MIN(created_at),workspace_id,company_id LIMIT ?",
          )
          .all(limit) as Array<{ workspace_id: number; company_id: number }>
      ).map((row) =>
        Object.freeze({
          workspaceId: row.workspace_id,
          companyId: row.company_id,
        }),
      ),
    );
  }
  private findSemanticMessages(
    sql: string,
    c: WorkspaceContext,
    companyId: number,
    limit: number,
    scopedConversation = true,
  ): readonly import("../conversation/domain/conversation.js").ConversationMessage[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    const rows = this.db
      .prepare(sql)
      .all(
        ...(scopedConversation
          ? [c.workspaceId, companyId, c.workspaceId, companyId, limit]
          : [c.workspaceId, companyId, limit]),
      ) as Array<{
      id: string;
      conversation_id: string;
      sender_participant_id: string;
      direction: "inbound" | "outbound";
      content: string;
      idempotency_key: string | null;
      execution_record_id: string | null;
      created_at: string;
    }>;
    return Object.freeze(
      rows.map(
        (row) =>
          Object.freeze({
            id: row.id,
            conversationId: row.conversation_id,
            senderParticipantId: row.sender_participant_id,
            direction: row.direction,
            content: row.content,
            idempotencyKey: row.idempotency_key,
            executionRecordId: row.execution_record_id,
            createdAt: row.created_at,
          }) as import("../conversation/domain/conversation.js").ConversationMessage,
      ),
    );
  }
  public enqueueTranscription(
    c: WorkspaceContext,
    companyId: number,
    v: Omit<
      AudioTranscriptionRequest,
      | "state"
      | "leaseOwner"
      | "leaseExpiresAt"
      | "attemptCount"
      | "safeOutcome"
      | "safeFailureCategory"
      | "completedAt"
    >,
  ) {
    return this.enqueueWork(
      "audio_transcription_requests",
      c,
      companyId,
      v,
      "media_asset_id",
    ) as {
      readonly kind: "created" | "replayed" | "conflict" | "not_found";
      readonly request?: AudioTranscriptionRequest;
    };
  }
  public enqueueTranscriptionAndBlockExecution(
    c: WorkspaceContext,
    companyId: number,
    connectionId: string,
    eventId: string,
    v: {
      readonly id: string;
      readonly mediaAssetId: string;
      readonly createdAt: string;
      readonly updatedAt: string;
    },
  ) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const execution = this.db
        .prepare(
          "SELECT r.id,r.media_gate_state,r.state,e.conversation_id,e.conversation_message_id,cc.authority_generation FROM channel_execution_requests r JOIN channel_provider_events e ON e.id=r.channel_provider_event_id JOIN whatsapp_connections w ON w.id=e.transport_connection_id JOIN conversation_controls cc ON cc.conversation_id=e.conversation_id WHERE e.id=? AND w.id=? AND w.workspace_id=? AND w.company_id=?",
        )
        .get(eventId, connectionId, c.workspaceId, companyId) as
        | {
            id: string;
            media_gate_state: string;
            state: string;
            conversation_id: string | null;
            conversation_message_id: string | null;
            authority_generation: number;
          }
        | undefined;
      if (
        !execution ||
        execution.state !== "pending" ||
        execution.media_gate_state !== "blocked_by_media" ||
        !execution.conversation_id ||
        !execution.conversation_message_id
      ) {
        this.db.exec("COMMIT;");
        return { kind: "conflict" as const };
      }
      const queued = this.enqueueWork(
        "audio_transcription_requests",
        c,
        companyId,
        {
          ...v,
          workspaceId: c.workspaceId,
          companyId,
          conversationId: execution.conversation_id,
          messageId: execution.conversation_message_id,
          expectedAuthorityGeneration: execution.authority_generation,
        },
        "media_asset_id",
      ) as {
        kind: "created" | "replayed" | "conflict" | "not_found";
        request?: AudioTranscriptionRequest;
      };
      if (
        (queued.kind !== "created" && queued.kind !== "replayed") ||
        !queued.request
      ) {
        this.db.exec("ROLLBACK;");
        return queued;
      }
      if (
        this.db
          .prepare(
            "UPDATE channel_execution_requests SET media_gate_state='blocked_by_transcript',updated_at=? WHERE id=? AND state='pending' AND media_gate_state='blocked_by_media'",
          )
          .run(v.updatedAt, execution.id).changes !== 1
      )
        throw new Error("Transcription gate CAS lost.");
      this.db.exec("COMMIT;");
      return queued;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw error;
    }
  }
  public enqueueSynthesis(
    c: WorkspaceContext,
    companyId: number,
    v: Omit<
      VoiceSynthesisRequest,
      | "state"
      | "leaseOwner"
      | "leaseExpiresAt"
      | "attemptCount"
      | "safeOutcome"
      | "safeFailureCategory"
      | "completedAt"
      | "renditionSettlementId"
    >,
  ) {
    return this.enqueueWork(
      "voice_synthesis_requests",
      c,
      companyId,
      v,
      "outbound_delivery_id",
    ) as {
      readonly kind: "created" | "replayed" | "conflict" | "not_found";
      readonly request?: VoiceSynthesisRequest;
    };
  }
  private enqueueWork(
    table: "audio_transcription_requests" | "voice_synthesis_requests",
    c: WorkspaceContext,
    companyId: number,
    v: Record<string, unknown>,
    reference: "media_asset_id" | "outbound_delivery_id",
  ) {
    const messageId = v.messageId as string,
      ref = (
        reference === "media_asset_id" ? v.mediaAssetId : v.outboundDeliveryId
      ) as string,
      existing = this.findWork(table, c, companyId, messageId),
      existingByReference = this.findWorkByReference(
        table,
        c,
        companyId,
        reference,
        ref,
      );
    if (existing || existingByReference) {
      const candidate = existing ?? existingByReference!;
      const same =
        candidate.conversationId === v.conversationId &&
        candidate.messageId === messageId &&
        candidate.expectedAuthorityGeneration ===
          v.expectedAuthorityGeneration &&
        ((reference === "media_asset_id" &&
          (candidate as AudioTranscriptionRequest).mediaAssetId ===
            v.mediaAssetId) ||
          (reference === "outbound_delivery_id" &&
            (candidate as VoiceSynthesisRequest).outboundDeliveryId ===
              v.outboundDeliveryId));
      return same
        ? { kind: "replayed" as const, request: candidate }
        : { kind: "conflict" as const };
    }
    try {
      this.db
        .prepare(
          `INSERT INTO ${table}(id,workspace_id,company_id,conversation_id,conversation_message_id,${reference},expected_authority_generation,state,lease_owner,lease_expires_at,attempt_count,safe_outcome,safe_failure_category,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,'pending',NULL,NULL,0,NULL,NULL,?,?,NULL)`,
        )
        .run(
          v.id as string,
          c.workspaceId,
          companyId,
          v.conversationId as string,
          messageId,
          ref,
          v.expectedAuthorityGeneration as number,
          v.createdAt as string,
          v.updatedAt as string,
        );
      const saved = this.findWork(table, c, companyId, messageId);
      return saved
        ? { kind: "created" as const, request: saved }
        : { kind: "not_found" as const };
    } catch {
      return { kind: "not_found" as const };
    }
  }
  private findWork(
    table: "audio_transcription_requests" | "voice_synthesis_requests",
    c: WorkspaceContext,
    companyId: number,
    messageId: string,
  ): AudioTranscriptionRequest | VoiceSynthesisRequest | null {
    const r = this.db
      .prepare(
        `SELECT * FROM ${table} WHERE workspace_id=? AND company_id=? AND conversation_message_id=?`,
      )
      .get(c.workspaceId, companyId, messageId) as WorkRow | undefined;
    return r
      ? (work(r) as AudioTranscriptionRequest | VoiceSynthesisRequest)
      : null;
  }
  private findWorkByReference(
    table: "audio_transcription_requests" | "voice_synthesis_requests",
    c: WorkspaceContext,
    companyId: number,
    reference: "media_asset_id" | "outbound_delivery_id",
    value: string,
  ): AudioTranscriptionRequest | VoiceSynthesisRequest | null {
    const r = this.db
      .prepare(
        `SELECT * FROM ${table} WHERE workspace_id=? AND company_id=? AND ${reference}=?`,
      )
      .get(c.workspaceId, companyId, value) as WorkRow | undefined;
    return r
      ? (work(r) as AudioTranscriptionRequest | VoiceSynthesisRequest)
      : null;
  }
  public leaseTranscriptions(
    c: WorkspaceContext,
    companyId: number,
    l: VoiceLease,
  ): readonly AudioTranscriptionRequest[] {
    return this.leaseWork("audio_transcription_requests", c, companyId, l).map(
      (v) => v as AudioTranscriptionRequest,
    );
  }
  public leaseSynthesis(
    c: WorkspaceContext,
    companyId: number,
    l: VoiceLease,
  ): readonly VoiceSynthesisRequest[] {
    return this.leaseWork("voice_synthesis_requests", c, companyId, l).map(
      (v) => v as VoiceSynthesisRequest,
    );
  }
  private leaseWork(
    table: "audio_transcription_requests" | "voice_synthesis_requests",
    c: WorkspaceContext,
    companyId: number,
    l: VoiceLease,
  ): readonly (AudioTranscriptionRequest | VoiceSynthesisRequest)[] {
    voiceBounded(l.owner, "Lease owner", 128);
    voiceTimestamp(l.now);
    voiceTimestamp(l.expiresAt);
    if (!Number.isSafeInteger(l.limit) || l.limit < 1) return [];
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM ${table} WHERE workspace_id=? AND company_id=? AND (state IN ('pending','retryable') OR (state='leased' AND lease_expires_at<=?)) ORDER BY created_at,id LIMIT ?`,
        )
        .all(c.workspaceId, companyId, l.now, l.limit) as WorkRow[];
      const out = [] as (AudioTranscriptionRequest | VoiceSynthesisRequest)[];
      for (const r of rows) {
        if (
          this.db
            .prepare(
              `UPDATE ${table} SET state='leased',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND (state IN ('pending','retryable') OR (state='leased' AND lease_expires_at<=?))`,
            )
            .run(
              l.owner,
              l.expiresAt,
              l.now,
              r.id,
              c.workspaceId,
              companyId,
              l.now,
            ).changes === 1
        ) {
          const saved = this.findWork(
            table,
            c,
            companyId,
            r.conversation_message_id,
          );
          if (saved) out.push(saved);
        }
      }
      this.db.exec("COMMIT;");
      return out;
    } catch (e) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw e;
    }
  }
  public settleTranscription(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    s: VoiceWorkSettlement,
  ): AudioTranscriptionRequest | null {
    return this.settleWork(
      "audio_transcription_requests",
      c,
      companyId,
      id,
      owner,
      s,
    ) as AudioTranscriptionRequest | null;
  }
  public finalizeTranscription(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    v: TranscriptionFinalization,
  ): TranscriptionFinalizationResult {
    voiceBounded(owner, "Lease owner", 128);
    const s = v.settlement,
      t = v.transcript;
    if (
      s.state !== "completed" ||
      s.completedAt === null ||
      t.outcome !== "completed"
    )
      throw new Error("Transcription finalization is invalid.");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.db
        .prepare(
          "SELECT w.*,r.id AS execution_id,r.state AS execution_state,r.media_gate_state,p.voice_ai_enabled,cc.state AS control_state,cc.authority_generation FROM audio_transcription_requests w JOIN channel_provider_events e ON e.conversation_id=w.conversation_id AND e.conversation_message_id=w.conversation_message_id JOIN channel_execution_requests r ON r.channel_provider_event_id=e.id JOIN whatsapp_connections wc ON wc.id=e.transport_connection_id JOIN whatsapp_voice_policies p ON p.whatsapp_connection_id=wc.id LEFT JOIN conversation_controls cc ON cc.conversation_id=w.conversation_id WHERE w.id=? AND w.workspace_id=? AND w.company_id=? AND wc.workspace_id=? AND wc.company_id=?",
        )
        .get(id, c.workspaceId, companyId, c.workspaceId, companyId) as
        | (WorkRow & {
            execution_id: string;
            execution_state: string;
            media_gate_state: string;
            voice_ai_enabled: number;
            control_state: string | null;
            authority_generation: number | null;
          })
        | undefined;
      if (
        !current ||
        current.state !== "leased" ||
        current.lease_owner !== owner ||
        current.lease_expires_at === null ||
        current.lease_expires_at <= s.updatedAt
      ) {
        this.db.exec("COMMIT;");
        return { kind: "lease_lost" };
      }
      if (
        current.conversation_id !== t.conversationId ||
        current.conversation_message_id !== t.messageId ||
        current.media_asset_id !== t.mediaAssetId
      ) {
        this.db.exec("COMMIT;");
        return { kind: "conflict" };
      }
      const transcriptResult = this.createTranscript(c, companyId, t);
      if (
        transcriptResult.kind !== "created" &&
        transcriptResult.kind !== "replayed"
      ) {
        this.db.exec("ROLLBACK;");
        return { kind: "conflict" };
      }
      const savedTranscript = transcriptResult.transcript;
      const eligible =
        current.voice_ai_enabled === 1 &&
        current.control_state === "automated" &&
        current.authority_generation ===
          current.expected_authority_generation &&
        current.execution_state === "pending" &&
        current.media_gate_state === "blocked_by_transcript";
      if (
        this.db
          .prepare(
            "UPDATE audio_transcription_requests SET state=?,lease_owner=NULL,lease_expires_at=NULL,safe_outcome=?,safe_failure_category=?,completed_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=?",
          )
          .run(
            eligible ? "completed" : "suppressed",
            safe(s.safeOutcome, "Safe outcome"),
            safe(s.safeFailureCategory, "Safe failure"),
            s.completedAt,
            s.updatedAt,
            id,
            owner,
          ).changes !== 1
      )
        throw new Error("Transcription settlement CAS lost.");
      const request = this.findWork(
        "audio_transcription_requests",
        c,
        companyId,
        current.conversation_message_id,
      ) as AudioTranscriptionRequest;
      const changed = eligible
        ? this.db
            .prepare(
              "UPDATE channel_execution_requests SET media_gate_state='open',updated_at=? WHERE id=? AND state='pending' AND media_gate_state='blocked_by_transcript'",
            )
            .run(s.updatedAt, current.execution_id).changes
        : this.db
            .prepare(
              "UPDATE channel_execution_requests SET state='completed',outcome='suppressed',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND state='pending' AND media_gate_state='blocked_by_transcript'",
            )
            .run(s.updatedAt, current.execution_id).changes;
      if (changed !== 1)
        throw new Error("Transcription execution settlement CAS lost.");
      this.db.exec("COMMIT;");
      return {
        kind: eligible ? "opened" : "suppressed",
        request,
        transcript: savedTranscript,
      };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw error;
    }
  }
  public settleSynthesis(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    s: VoiceWorkSettlement,
  ): VoiceSynthesisRequest | null {
    return this.settleWork(
      "voice_synthesis_requests",
      c,
      companyId,
      id,
      owner,
      s,
    ) as VoiceSynthesisRequest | null;
  }
  public authorizeSynthesis(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    at: string,
  ): import("../whatsapp/application/voicePorts.js").SynthesisAuthorizationResult {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.db
        .prepare(
          "SELECT w.conversation_id,w.expected_authority_generation,w.state,w.lease_owner,w.lease_expires_at,m.content,cc.state AS control_state,cc.authority_generation,p.voice_ai_enabled,p.audio_response_mode,d.id AS delivery_id FROM voice_synthesis_requests w JOIN conversation_messages m ON m.id=w.conversation_message_id JOIN outbound_deliveries d ON d.id=w.outbound_delivery_id JOIN provider_message_records r ON r.id=d.provider_message_record_id JOIN whatsapp_voice_policies p ON p.whatsapp_connection_id=r.transport_connection_id LEFT JOIN conversation_controls cc ON cc.conversation_id=w.conversation_id WHERE w.id=? AND w.workspace_id=? AND w.company_id=?",
        )
        .get(id, c.workspaceId, companyId) as
        | {
            conversation_id: string;
            expected_authority_generation: number;
            state: string;
            lease_owner: string | null;
            lease_expires_at: string | null;
            content: string;
            control_state: string | null;
            authority_generation: number | null;
            voice_ai_enabled: number;
            audio_response_mode: string;
            delivery_id: string;
          }
        | undefined;
      if (
        !current ||
        current.state !== "leased" ||
        current.lease_owner !== owner ||
        current.lease_expires_at === null ||
        current.lease_expires_at <= at
      ) {
        this.db.exec("COMMIT;");
        return { kind: "lease_lost" };
      }
      const allowed =
        current.control_state === "automated" &&
        current.authority_generation ===
          current.expected_authority_generation &&
        current.voice_ai_enabled === 1 &&
        current.audio_response_mode === "voice_with_text_fallback";
      if (!allowed) {
        this.db
          .prepare(
            "UPDATE voice_synthesis_requests SET state='suppressed',lease_owner=NULL,lease_expires_at=NULL,safe_outcome='suppressed',safe_failure_category=NULL,completed_at=?,updated_at=? WHERE id=?",
          )
          .run(at, at, id);
        this.db
          .prepare(
            "UPDATE outbound_deliveries SET state='suppressed',lease_owner=NULL,lease_expires_at=NULL,safe_error_category=NULL,updated_at=? WHERE id=? AND state='blocked_by_synthesis'",
          )
          .run(at, current.delivery_id);
        this.db.exec("COMMIT;");
        return { kind: "suppressed" };
      }
      this.db.exec("COMMIT;");
      return { kind: "authorized", text: current.content };
    } catch (e) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw e;
    }
  }
  public finalizeSynthesis(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    v: import("../whatsapp/application/voicePorts.js").SynthesisFinalization,
  ): VoiceSynthesisRequest | null {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.db
        .prepare(
          "SELECT w.conversation_message_id,w.outbound_delivery_id,w.expected_authority_generation,w.state,w.lease_owner,w.lease_expires_at,cc.state AS control_state,cc.authority_generation,p.voice_ai_enabled,p.audio_response_mode FROM voice_synthesis_requests w JOIN outbound_deliveries d ON d.id=w.outbound_delivery_id JOIN provider_message_records r ON r.id=d.provider_message_record_id JOIN whatsapp_voice_policies p ON p.whatsapp_connection_id=r.transport_connection_id LEFT JOIN conversation_controls cc ON cc.conversation_id=w.conversation_id WHERE w.id=? AND w.workspace_id=? AND w.company_id=?",
        )
        .get(id, c.workspaceId, companyId) as
        | {
            conversation_message_id: string;
            outbound_delivery_id: string;
            expected_authority_generation: number;
            state: string;
            lease_owner: string | null;
            lease_expires_at: string | null;
            control_state: string | null;
            authority_generation: number | null;
            voice_ai_enabled: number;
            audio_response_mode: string;
          }
        | undefined;
      if (
        !current ||
        current.state !== "leased" ||
        current.lease_owner !== owner ||
        current.lease_expires_at === null ||
        current.lease_expires_at <= v.updatedAt
      ) {
        this.db.exec("COMMIT;");
        return null;
      }
      const allowed =
        current.control_state === "automated" &&
        current.authority_generation ===
          current.expected_authority_generation &&
        current.voice_ai_enabled === 1 &&
        current.audio_response_mode === "voice_with_text_fallback";
      if (!allowed) {
        this.db
          .prepare(
            "UPDATE voice_synthesis_requests SET state='suppressed',lease_owner=NULL,lease_expires_at=NULL,safe_outcome='suppressed',safe_failure_category=NULL,completed_at=?,updated_at=? WHERE id=?",
          )
          .run(v.updatedAt, v.updatedAt, id);
        this.db
          .prepare(
            "UPDATE outbound_deliveries SET state='suppressed',lease_owner=NULL,lease_expires_at=NULL,safe_error_category=NULL,updated_at=? WHERE id=? AND state='blocked_by_synthesis'",
          )
          .run(v.updatedAt, current.outbound_delivery_id);
        this.db.exec("COMMIT;");
        return this.findWork(
          "voice_synthesis_requests",
          c,
          companyId,
          current.conversation_message_id,
        ) as VoiceSynthesisRequest;
      }
      if (v.kind === "retryable") {
        this.db
          .prepare(
            "UPDATE voice_synthesis_requests SET state='retryable',lease_owner=NULL,lease_expires_at=NULL,safe_outcome='retryable',safe_failure_category=?,updated_at=? WHERE id=?",
          )
          .run(safe(v.safeFailureCategory, "Safe failure"), v.updatedAt, id);
      } else if (v.kind === "failed") {
        this.db
          .prepare(
            "UPDATE voice_synthesis_requests SET state='failed',lease_owner=NULL,lease_expires_at=NULL,safe_outcome='failed',safe_failure_category=?,completed_at=?,updated_at=? WHERE id=?",
          )
          .run(
            safe(v.safeFailureCategory, "Safe failure"),
            v.updatedAt,
            v.updatedAt,
            id,
          );
        this.db
          .prepare(
            "UPDATE outbound_deliveries SET state='pending',payload_kind='text',media_asset_id=NULL,safe_error_category=NULL,updated_at=? WHERE id=? AND state='blocked_by_synthesis'",
          )
          .run(v.updatedAt, current.outbound_delivery_id);
      } else {
        const asset = this.db
          .prepare(
            "SELECT id FROM media_assets WHERE id=? AND workspace_id=? AND company_id=? AND kind='audio' AND media_type='audio/ogg' AND status='ready'",
          )
          .get(v.mediaAssetId, c.workspaceId, companyId) as
          { id: string } | undefined;
        if (!asset) {
          this.db.exec("ROLLBACK;");
          return null;
        }
        this.db
          .prepare(
            "UPDATE voice_synthesis_requests SET state='completed',lease_owner=NULL,lease_expires_at=NULL,safe_outcome='completed',safe_failure_category=NULL,completed_at=?,updated_at=? WHERE id=?",
          )
          .run(v.updatedAt, v.updatedAt, id);
        this.db
          .prepare(
            "UPDATE outbound_deliveries SET state='pending',payload_kind='audio',media_asset_id=?,safe_error_category=NULL,updated_at=? WHERE id=? AND state='blocked_by_synthesis'",
          )
          .run(asset.id, v.updatedAt, current.outbound_delivery_id);
        const reservation = this.db
          .prepare(
            "INSERT INTO whatsapp_outbound_media_uploads(id,workspace_id,company_id,outbound_delivery_id,media_asset_id,provider_media_id,state,lease_owner,lease_expires_at,attempt_count,safe_error_category,created_at,updated_at) SELECT printf('wou_%016x',rowid),?,?,?,?,NULL,'pending_upload',NULL,NULL,0,NULL,?,? FROM voice_synthesis_requests WHERE outbound_delivery_id=? ON CONFLICT(outbound_delivery_id) DO NOTHING",
          )
          .run(
            c.workspaceId,
            companyId,
            current.outbound_delivery_id,
            asset.id,
            v.updatedAt,
            v.updatedAt,
            current.outbound_delivery_id,
          );
        const reserved = this.findUpload(
          c,
          companyId,
          current.outbound_delivery_id,
        );
        if (!reservation.changes && reserved?.mediaAssetId !== asset.id)
          throw new Error("Voice synthesis upload asset conflict.");
      }
      this.db.exec("COMMIT;");
      return this.findWork(
        "voice_synthesis_requests",
        c,
        companyId,
        current.conversation_message_id,
      ) as VoiceSynthesisRequest;
    } catch (e) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw e;
    }
  }
  private settleWork(
    table: "audio_transcription_requests" | "voice_synthesis_requests",
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    s: VoiceWorkSettlement,
  ) {
    if (
      s.state !== "completed" &&
      s.state !== "retryable" &&
      s.state !== "failed" &&
      s.state !== "suppressed"
    )
      throw new Error("Voice settlement state is invalid.");
    const complete = s.state === "retryable" ? null : s.completedAt;
    if (
      this.db
        .prepare(
          `UPDATE ${table} SET state=?,lease_owner=NULL,lease_expires_at=NULL,safe_outcome=?,safe_failure_category=?,completed_at=?,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND state='leased' AND lease_owner=? AND lease_expires_at>?`,
        )
        .run(
          s.state,
          safe(s.safeOutcome, "Safe outcome"),
          safe(s.safeFailureCategory, "Safe failure"),
          complete,
          s.updatedAt,
          id,
          c.workspaceId,
          companyId,
          owner,
          s.updatedAt,
        ).changes !== 1
    )
      return null;
    const r = this.db
      .prepare(`SELECT conversation_message_id FROM ${table} WHERE id=?`)
      .get(id) as { conversation_message_id: string };
    return this.findWork(table, c, companyId, r.conversation_message_id);
  }
  public createUpload(
    c: WorkspaceContext,
    companyId: number,
    v: Omit<
      WhatsAppOutboundMediaUpload,
      | "state"
      | "leaseOwner"
      | "leaseExpiresAt"
      | "attemptCount"
      | "providerMediaId"
      | "safeErrorCategory"
    >,
  ) {
    const found = this.findUpload(c, companyId, v.outboundDeliveryId);
    if (found)
      return found.mediaAssetId === v.mediaAssetId
        ? { kind: "replayed" as const, upload: found }
        : { kind: "conflict" as const };
    try {
      this.db
        .prepare(
          "INSERT INTO whatsapp_outbound_media_uploads(id,workspace_id,company_id,outbound_delivery_id,media_asset_id,provider_media_id,state,lease_owner,lease_expires_at,attempt_count,safe_error_category,created_at,updated_at) VALUES(?,?,?,?,?,NULL,'pending_upload',NULL,NULL,0,NULL,?,?)",
        )
        .run(
          v.id,
          c.workspaceId,
          companyId,
          v.outboundDeliveryId,
          v.mediaAssetId,
          v.createdAt,
          v.updatedAt,
        );
      const saved = this.findUpload(c, companyId, v.outboundDeliveryId);
      return saved
        ? { kind: "created" as const, upload: saved }
        : { kind: "not_found" as const };
    } catch {
      return { kind: "not_found" as const };
    }
  }
  private findUpload(
    c: WorkspaceContext,
    companyId: number,
    deliveryId: string,
  ): WhatsAppOutboundMediaUpload | null {
    const r = this.db
      .prepare(
        "SELECT * FROM whatsapp_outbound_media_uploads WHERE workspace_id=? AND company_id=? AND outbound_delivery_id=?",
      )
      .get(c.workspaceId, companyId, deliveryId) as UploadRow | undefined;
    return r ? upload(r) : null;
  }
  public leaseUploads(
    c: WorkspaceContext,
    companyId: number,
    l: VoiceLease,
  ): readonly WhatsAppOutboundMediaUpload[] {
    voiceBounded(l.owner, "Lease owner", 128);
    if (!Number.isSafeInteger(l.limit) || l.limit < 1) return [];
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM whatsapp_outbound_media_uploads WHERE workspace_id=? AND company_id=? AND (state IN ('pending_upload','expired') OR (state='uploading' AND lease_expires_at<=?)) ORDER BY created_at,id LIMIT ?",
        )
        .all(c.workspaceId, companyId, l.now, l.limit) as UploadRow[];
      const out: WhatsAppOutboundMediaUpload[] = [];
      for (const r of rows)
        if (
          this.db
            .prepare(
              "UPDATE whatsapp_outbound_media_uploads SET state='uploading',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND (state IN ('pending_upload','expired') OR (state='uploading' AND lease_expires_at<=?))",
            )
            .run(
              l.owner,
              l.expiresAt,
              l.now,
              r.id,
              c.workspaceId,
              companyId,
              l.now,
            ).changes === 1
        ) {
          const v = this.findUpload(c, companyId, r.outbound_delivery_id);
          if (v) out.push(v);
        }
      this.db.exec("COMMIT;");
      return out;
    } catch (e) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw e;
    }
  }
  public settleUpload(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    state: "uploaded" | "expired" | "failed",
    providerMediaId: string | null,
    safeErrorCategory: string | null,
    updatedAt: string,
  ): WhatsAppOutboundMediaUpload | null {
    if (providerMediaId !== null)
      voiceBounded(providerMediaId, "Provider media ID", 200);
    if (
      this.db
        .prepare(
          "UPDATE whatsapp_outbound_media_uploads SET state=?,provider_media_id=?,safe_error_category=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND state='uploading' AND lease_owner=? AND lease_expires_at>?",
        )
        .run(
          state,
          providerMediaId,
          safe(safeErrorCategory, "Safe error"),
          updatedAt,
          id,
          c.workspaceId,
          companyId,
          owner,
          updatedAt,
        ).changes !== 1
    )
      return null;
    const r = this.db
      .prepare(
        "SELECT outbound_delivery_id FROM whatsapp_outbound_media_uploads WHERE id=?",
      )
      .get(id) as { outbound_delivery_id: string };
    return this.findUpload(c, companyId, r.outbound_delivery_id);
  }
  public authorizeUpload(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    at: string,
  ):
    | {
        readonly kind: "authorized";
        readonly connectionId: string;
        readonly mediaType: string;
        readonly filename: string | null;
      }
    | { readonly kind: "suppressed" | "lease_lost" } {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.uploadAuthority(c, companyId, id, owner, at);
      if (!row) {
        this.db.exec("COMMIT;");
        return { kind: "lease_lost" };
      }
      if (!row.allowed) {
        this.suppressUpload(id, at);
        this.db.exec("COMMIT;");
        return { kind: "suppressed" };
      }
      this.db.exec("COMMIT;");
      return {
        kind: "authorized",
        connectionId: row.connection_id,
        mediaType: row.media_type,
        filename: null,
      };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw error;
    }
  }
  public finalizeUpload(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    result: import("../whatsapp/application/outboundMediaUploadPort.js").WhatsAppOutboundMediaUploadResult,
    at: string,
  ): WhatsAppOutboundMediaUpload | null {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const row = this.uploadAuthority(c, companyId, id, owner, at);
      if (!row) {
        this.db.exec("COMMIT;");
        return null;
      }
      if (!row.allowed) {
        this.suppressUpload(id, at);
        this.db.exec("COMMIT;");
        return this.findUpload(c, companyId, row.outbound_delivery_id);
      }
      const state =
          result.kind === "uploaded"
            ? "uploaded"
            : result.kind === "retryable"
              ? "expired"
              : "failed",
        mediaId = result.kind === "uploaded" ? result.providerMediaId : null,
        error = result.kind === "uploaded" ? null : result.safeFailureCategory;
      this.db
        .prepare(
          "UPDATE whatsapp_outbound_media_uploads SET state=?,provider_media_id=?,safe_error_category=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND state='uploading' AND lease_owner=? AND lease_expires_at>?",
        )
        .run(state, mediaId, safe(error, "Safe error"), at, id, owner, at);
      if (result.kind === "failed")
        this.db
          .prepare(
            "UPDATE outbound_deliveries SET state='pending',payload_kind='text',media_asset_id=NULL,safe_error_category=NULL,updated_at=? WHERE id=? AND state IN ('pending','retryable') AND payload_kind='audio' AND response_policy='deferred_voice'",
          )
          .run(at, row.outbound_delivery_id);
      this.db.exec("COMMIT;");
      return this.findUpload(c, companyId, row.outbound_delivery_id);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw error;
    }
  }
  public findUploadedProviderMediaId(c: WorkspaceContext, companyId: number, outboundDeliveryId: string): string | null {
    const row = this.db.prepare("SELECT provider_media_id FROM whatsapp_outbound_media_uploads WHERE workspace_id=? AND company_id=? AND outbound_delivery_id=? AND state='uploaded' AND provider_media_id IS NOT NULL").get(c.workspaceId, companyId, outboundDeliveryId) as { provider_media_id: string } | undefined;
    return row ? voiceBounded(row.provider_media_id, "Provider media ID", 200) : null;
  }
  private uploadAuthority(
    c: WorkspaceContext,
    companyId: number,
    id: string,
    owner: string,
    at: string,
  ) {
    return this.db
      .prepare(
        "SELECT u.outbound_delivery_id,d.transport_connection_id AS connection_id,a.media_type,CASE WHEN d.state IN ('pending','retryable') AND d.payload_kind='audio' AND d.response_policy='deferred_voice' AND d.media_asset_id=u.media_asset_id AND cc.state='automated' AND cc.authority_generation=d.expected_authority_generation AND p.voice_ai_enabled=1 AND p.audio_response_mode='voice_with_text_fallback' THEN 1 ELSE 0 END AS allowed FROM whatsapp_outbound_media_uploads u JOIN outbound_deliveries d ON d.id=u.outbound_delivery_id JOIN provider_message_records r ON r.id=d.provider_message_record_id JOIN media_assets a ON a.id=u.media_asset_id JOIN whatsapp_voice_policies p ON p.whatsapp_connection_id=d.transport_connection_id LEFT JOIN conversation_controls cc ON cc.conversation_id=(SELECT conversation_id FROM conversation_messages WHERE id=r.conversation_message_id) WHERE u.id=? AND u.workspace_id=? AND u.company_id=? AND u.state='uploading' AND u.lease_owner=? AND u.lease_expires_at>?",
      )
      .get(id, c.workspaceId, companyId, owner, at) as
      | {
          outbound_delivery_id: string;
          connection_id: string;
          media_type: string;
          allowed: number;
        }
      | undefined;
  }
  private suppressUpload(id: string, at: string): void {
    this.db
      .prepare(
        "UPDATE whatsapp_outbound_media_uploads SET state='failed',provider_media_id=NULL,safe_error_category='suppressed',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
      )
      .run(at, id);
    this.db
      .prepare(
        "UPDATE outbound_deliveries SET state='suppressed',lease_owner=NULL,lease_expires_at=NULL,safe_error_category=NULL,updated_at=? WHERE id=(SELECT outbound_delivery_id FROM whatsapp_outbound_media_uploads WHERE id=?) AND state IN ('pending','retryable')",
      )
      .run(at, id);
  }
  public appendVisibility(
    c: WorkspaceContext,
    companyId: number,
    v: VoiceResponseVisibility,
  ) {
    const existing = this.findVisibility(
      c,
      companyId,
      v.messageId,
      v.outboundDeliveryId,
    );
    if (existing)
      return existing.conversationId === v.conversationId &&
        existing.committedAt === v.committedAt
        ? { kind: "replayed" as const, visibility: existing }
        : { kind: "conflict" as const };
    try {
      this.db
        .prepare(
          "INSERT INTO voice_response_visibility(workspace_id,company_id,conversation_id,conversation_message_id,outbound_delivery_id,kind,committed_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          c.workspaceId,
          companyId,
          v.conversationId,
          v.messageId,
          v.outboundDeliveryId,
          "externally_committed",
          v.committedAt,
          v.createdAt,
        );
      const saved = this.findVisibility(
        c,
        companyId,
        v.messageId,
        v.outboundDeliveryId,
      );
      return saved
        ? { kind: "created" as const, visibility: saved }
        : { kind: "not_found" as const };
    } catch {
      return { kind: "not_found" as const };
    }
  }
  public findVisibility(
    c: WorkspaceContext,
    companyId: number,
    messageId: string,
    deliveryId: string,
  ): VoiceResponseVisibility | null {
    const r = this.db
      .prepare(
        "SELECT * FROM voice_response_visibility WHERE workspace_id=? AND company_id=? AND conversation_message_id=? AND outbound_delivery_id=?",
      )
      .get(c.workspaceId, companyId, messageId, deliveryId) as
      VisibilityRow | undefined;
    return r ? visibility(r) : null;
  }
  public findMessageReadModel(c: WorkspaceContext, companyId: number, conversationId: string, messageId: string): VoiceMessageReadModel | null {
    const row = this.voiceReadRow(c, companyId, conversationId, messageId);
    if (!row || (row.direction === "inbound" && row.transcription_state === null && !this.isUnsupportedInbound(c, companyId, conversationId, messageId)) || (row.direction === "outbound" && row.response_policy !== "deferred_voice")) return null;
    const inbound = row.direction === "inbound";
    const deferredState = inbound ? null : row.delivery_state === "accepted" || row.delivery_state === "delivered" || row.delivery_state === "read" ? row.delivery_state : row.delivery_state === "uncertain" ? "uncertain" : row.delivery_state === "permanent_failure" ? "failed" : row.delivery_state === "suppressed" || row.synthesis_state === "suppressed" ? "suppressed" : row.payload_kind === "text" || row.synthesis_state === "failed" || row.upload_state === "failed" ? "fallback" : row.payload_kind === "audio" && row.upload_state === "uploaded" ? "audio_ready" : "processing";
    const transcriptionState = row.transcript_outcome === "completed" ? "completed" : row.transcript_outcome === "unsupported" || this.isUnsupportedInbound(c, companyId, conversationId, messageId) ? "unsupported" : row.transcription_state === "pending" || row.transcription_state === "leased" || row.transcription_state === "retryable" ? "pending" : row.transcription_state === "failed" ? "failed" : row.transcription_state === "suppressed" ? "suppressed" : null;
    return Object.freeze({ messageId, direction: row.direction, modality: inbound ? "audio" : "voice", transcript: inbound && row.transcript_outcome === "completed" ? row.normalized_transcript : null, transcriptLanguageTag: inbound && row.transcript_outcome === "completed" ? row.language_tag : null, transcriptionState: inbound ? transcriptionState : null, deferredState, fallbackAvailable: !inbound && (row.payload_kind === "text" || row.synthesis_state === "failed" || row.upload_state === "failed"), playbackAvailable: row.playback_asset_id !== null && row.playback_media_type !== null });
  }
  private isUnsupportedInbound(c: WorkspaceContext, companyId: number, conversationId: string, messageId: string): boolean {
    return this.db.prepare("SELECT 1 FROM conversation_messages m JOIN conversations cn ON cn.id=m.conversation_id JOIN companies co ON co.id=cn.company_id JOIN whatsapp_inbound_media i ON i.conversation_message_id=m.id JOIN channel_provider_events e ON e.id=i.channel_provider_event_id JOIN channel_execution_requests r ON r.channel_provider_event_id=e.id WHERE m.id=? AND m.direction='inbound' AND cn.id=? AND co.workspace_id=? AND co.id=? AND i.workspace_id=? AND i.company_id=? AND i.provider_kind='audio' AND r.state='unsupported' AND r.outcome='unsupported' LIMIT 1").get(messageId, conversationId, c.workspaceId, companyId, c.workspaceId, companyId) !== undefined;
  }
  public findPlayback(c: WorkspaceContext, companyId: number, conversationId: string, messageId: string): VoicePlayback | null {
    const row = this.voiceReadRow(c, companyId, conversationId, messageId);
    if (!row || (row.direction === "outbound" && row.response_policy !== "deferred_voice") || row.playback_asset_id === null || row.playback_media_type === null || !["audio/mpeg", "audio/ogg", "audio/wav"].includes(row.playback_media_type)) return null;
    return Object.freeze({ assetId: row.playback_asset_id, mediaType: row.playback_media_type as VoicePlayback["mediaType"] });
  }
  private voiceReadRow(c: WorkspaceContext, companyId: number, conversationId: string, messageId: string) {
    return this.db.prepare("SELECT m.direction,t.normalized_transcript,t.language_tag,t.outcome AS transcript_outcome,tr.state AS transcription_state,d.response_policy,d.state AS delivery_state,d.payload_kind,s.state AS synthesis_state,u.state AS upload_state,CASE WHEN m.direction='inbound' THEN (SELECT a.id FROM whatsapp_inbound_media i JOIN media_assets a ON a.id=i.media_asset_id WHERE i.conversation_message_id=m.id AND i.workspace_id=? AND i.company_id=? AND i.provider_kind='audio' AND i.state='associated' AND a.kind='audio' AND a.status='ready' AND a.deleted_at IS NULL LIMIT 1) ELSE (SELECT a.id FROM media_assets a WHERE a.id=d.media_asset_id AND a.kind='audio' AND a.status='ready' AND a.deleted_at IS NULL LIMIT 1) END AS playback_asset_id,CASE WHEN m.direction='inbound' THEN (SELECT a.media_type FROM whatsapp_inbound_media i JOIN media_assets a ON a.id=i.media_asset_id WHERE i.conversation_message_id=m.id AND i.workspace_id=? AND i.company_id=? AND i.provider_kind='audio' AND i.state='associated' AND a.kind='audio' AND a.status='ready' AND a.deleted_at IS NULL LIMIT 1) ELSE (SELECT a.media_type FROM media_assets a WHERE a.id=d.media_asset_id AND a.kind='audio' AND a.status='ready' AND a.deleted_at IS NULL LIMIT 1) END AS playback_media_type FROM conversation_messages m JOIN conversations cn ON cn.id=m.conversation_id JOIN companies co ON co.id=cn.company_id LEFT JOIN conversation_audio_transcripts t ON t.conversation_message_id=m.id AND t.workspace_id=? AND t.company_id=? LEFT JOIN audio_transcription_requests tr ON tr.conversation_message_id=m.id AND tr.workspace_id=? AND tr.company_id=? LEFT JOIN provider_message_records p ON p.conversation_message_id=m.id AND p.direction='outbound' AND p.communication_channel='whatsapp' LEFT JOIN outbound_deliveries d ON d.provider_message_record_id=p.id LEFT JOIN voice_synthesis_requests s ON s.outbound_delivery_id=d.id AND s.workspace_id=? AND s.company_id=? LEFT JOIN whatsapp_outbound_media_uploads u ON u.outbound_delivery_id=d.id AND u.workspace_id=? AND u.company_id=? WHERE m.id=? AND m.conversation_id=? AND cn.company_id=? AND co.workspace_id=? LIMIT 1").get(c.workspaceId,companyId,c.workspaceId,companyId,c.workspaceId,companyId,c.workspaceId,companyId,c.workspaceId,companyId,c.workspaceId,companyId,messageId,conversationId,companyId,c.workspaceId) as { direction:"inbound"|"outbound"; normalized_transcript:string|null; language_tag:string|null; transcript_outcome:string|null; transcription_state:string|null; response_policy:string|null; delivery_state:string|null; payload_kind:string|null; synthesis_state:string|null; upload_state:string|null; playback_asset_id:string|null; playback_media_type:string|null } | undefined;
  }
}
