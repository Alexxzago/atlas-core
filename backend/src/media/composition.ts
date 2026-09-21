import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { SqlDatabase } from "../config/sqlDatabase.js";
import { BinaryMediaInspector } from "./infrastructure/mediaInspector.js";
import { createAsyncMediaPersistence } from "./infrastructure/asyncMediaFactory.js";
import { LocalMediaStorage } from "./infrastructure/localMediaStorage.js";
import type { MediaAssociationOwnerResolver, MediaStoragePort } from "./application/ports.js";
import { ConversationMessageMediaAssociationOwnerResolver, MediaAssociationOwnerResolverRegistry } from "../repositories/mediaAssociationOwnerResolvers.js";
import { MediaService } from "./services/mediaService.js";
import { MediaRepository } from "../repositories/mediaRepository.js";

export interface MediaCore {
  readonly service: MediaService;
  readonly owners: MediaAssociationOwnerResolver;
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

/** Production media composition uses the async SQL persistence boundary. */
export function createAsyncMediaCore(database: SqlDatabase, storageOrRoot: MediaStoragePort | string, clock: { now(): string }, persistence: ReturnType<typeof createAsyncMediaPersistence> = createAsyncMediaPersistence(database)): MediaCore {
  const storage = typeof storageOrRoot === "string" ? new LocalMediaStorage(storageOrRoot) : storageOrRoot;
  return Object.freeze({ service: new MediaService(persistence.media, storage, new BinaryMediaInspector(), persistence.owners, clock), owners: persistence.owners });
}

export function createAsyncLocalMediaCore(database: SqlDatabase, root: string, clock: { now(): string }, persistence: ReturnType<typeof createAsyncMediaPersistence> = createAsyncMediaPersistence(database)): MediaCore {
  return createAsyncMediaCore(database, root, clock, persistence);
}
