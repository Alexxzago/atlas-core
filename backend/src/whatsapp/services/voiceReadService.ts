import type { MediaService } from "../../media/services/mediaService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AsyncVoiceLookupPort, VoiceRepositoryPort } from "../application/voicePorts.js";
import type { VoiceMessageReadModel } from "../domain/voice.js";

export class VoiceReadNotFoundError extends Error {}
export class VoiceReadService {
  public constructor(private readonly voices: Pick<AsyncVoiceLookupPort, "findMessageReadModel" | "findPlayback"> | Pick<VoiceRepositoryPort, "findMessageReadModel" | "findPlayback">, private readonly media: Pick<MediaService, "open">) {}
  public async read(context: WorkspaceContext, companyId: number, conversationId: string, messageId: string): Promise<VoiceMessageReadModel> { const value = await this.voices.findMessageReadModel(context, companyId, conversationId, messageId); if (!value) throw new VoiceReadNotFoundError(); return value; }
  public async playback(context: WorkspaceContext, companyId: number, conversationId: string, messageId: string): Promise<{ readonly mediaType: string; readonly content: Uint8Array }> { const playback = await this.voices.findPlayback(context, companyId, conversationId, messageId); if (!playback) throw new VoiceReadNotFoundError(); try { return Object.freeze({ mediaType: playback.mediaType, content: await this.media.open(context, companyId, playback.assetId) }); } catch { throw new VoiceReadNotFoundError(); } }
}
