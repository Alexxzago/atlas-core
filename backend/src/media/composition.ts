import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import { BinaryMediaInspector } from "./infrastructure/mediaInspector.js";
import { LocalMediaStorage } from "./infrastructure/localMediaStorage.js";
import { ConversationMessageMediaAssociationOwnerResolver, MediaAssociationOwnerResolverRegistry } from "../repositories/mediaAssociationOwnerResolvers.js";
import { MediaService } from "./services/mediaService.js";
import { MediaRepository } from "../repositories/mediaRepository.js";

export interface MediaCore {
  readonly service: MediaService;
  readonly owners: MediaAssociationOwnerResolverRegistry;
}

export function createMediaCore(database: SynchronousDatabase, root: string, clock: { now(): string }): MediaCore {
  const owners = new MediaAssociationOwnerResolverRegistry();
  owners.register(new ConversationMessageMediaAssociationOwnerResolver(database));
  return Object.freeze({ service: new MediaService(new MediaRepository(database), new LocalMediaStorage(root), new BinaryMediaInspector(), owners, clock), owners });
}
