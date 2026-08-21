import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { MediaAssociationOwnerResolver } from "../media/application/ports.js";
import type { MediaAssociationOwnerType } from "../media/domain/media.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export interface MediaAssociationSubjectOwnerResolver {
  readonly type: MediaAssociationOwnerType;
  owns(context: WorkspaceContext, companyId: number, id: string): boolean;
}

export interface ConversationMessageMediaOwner {
  readonly workspaceId: number;
  readonly companyId: number;
}

export class ConversationMessageMediaAssociationOwnerResolver implements MediaAssociationSubjectOwnerResolver {
  public readonly type = "conversation_message" as const;
  public constructor(private readonly database: SynchronousDatabase) {}

  public resolve(context: WorkspaceContext, companyId: number, id: string): ConversationMessageMediaOwner | null {
    const row = this.database.prepare("SELECT c.workspace_id,c.id AS company_id FROM conversation_messages m JOIN conversations v ON v.id=m.conversation_id JOIN companies c ON c.id=v.company_id WHERE m.id=? AND c.workspace_id=? AND c.id=?").get(id, context.workspaceId, companyId) as { workspace_id: number; company_id: number } | undefined;
    return row ? Object.freeze({ workspaceId: row.workspace_id, companyId: row.company_id }) : null;
  }

  public owns(context: WorkspaceContext, companyId: number, id: string): boolean {
    return this.resolve(context, companyId, id) !== null;
  }
}

export class MediaAssociationOwnerResolverRegistry implements MediaAssociationOwnerResolver {
  private readonly resolvers = new Map<MediaAssociationOwnerType, MediaAssociationSubjectOwnerResolver>();

  public register(resolver: MediaAssociationSubjectOwnerResolver): void {
    if (this.resolvers.has(resolver.type)) throw new Error(`Media association owner resolver is already registered for ${resolver.type}.`);
    this.resolvers.set(resolver.type, resolver);
  }

  public owns(context: WorkspaceContext, companyId: number, type: MediaAssociationOwnerType, id: string): boolean {
    return this.resolvers.get(type)?.owns(context, companyId, id) ?? false;
  }
}
