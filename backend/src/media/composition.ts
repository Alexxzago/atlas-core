import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import { BinaryMediaInspector } from "./infrastructure/mediaInspector.js";
import { LocalMediaStorage } from "./infrastructure/localMediaStorage.js";
import type { MediaStoragePort } from "./application/ports.js";
import { ConversationMessageMediaAssociationOwnerResolver, MediaAssociationOwnerResolverRegistry } from "../repositories/mediaAssociationOwnerResolvers.js";
import { MediaService } from "./services/mediaService.js";
import { MediaRepository } from "../repositories/mediaRepository.js";

export interface MediaCore {
  readonly service: MediaService;
  readonly owners: MediaAssociationOwnerResolverRegistry;
}

export function createMediaCore(database: SynchronousDatabase, storageOrRoot: MediaStoragePort | string, clock: { now(): string }): MediaCore {
  const owners = new MediaAssociationOwnerResolverRegistry();
  owners.register(new ConversationMessageMediaAssociationOwnerResolver(database));
  const storage = typeof storageOrRoot === "string" ? new LocalMediaStorage(storageOrRoot) : storageOrRoot;
  return Object.freeze({ service: new MediaService(new MediaRepository(database), storage, new BinaryMediaInspector(), owners, clock), owners });
}

export function createLocalMediaCore(database: SynchronousDatabase, root: string, clock: { now(): string }): MediaCore {
  return createMediaCore(database, root, clock);
}
