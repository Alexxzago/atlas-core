import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import type { MediaStoragePort, StagedMedia } from "../application/ports.js";
import { MEDIA_LIMITS, MediaDomainError } from "../domain/media.js";

const blobId = /^mbl_[a-f0-9]{32}$/u;
const temporaryId = /^tmp_[a-f0-9]{32}$/u;
export function rejectReparsePoint(stat: { isSymbolicLink(): boolean }): void { if (stat.isSymbolicLink()) throw new MediaDomainError("media_unsafe_reparse"); }
export interface LocalMediaCleanupPort { close(file: { close(): Promise<void> }): Promise<void>; remove(path: string): Promise<void>; }
const defaultCleanup: LocalMediaCleanupPort = { close: file => file.close(), remove: path => rm(path, { force: true }) };

/**
 * The configured root must be application-owned and not writable by untrusted principals.
 * Node has no Windows no-follow primitive for every path operation; this flat, generated-name
 * layout avoids attacker-controlled path components and rejects observed reparse points.
 */
export class LocalMediaStorage implements MediaStoragePort {
  private readonly configuredRoot: string;
  public constructor(root: string, private readonly cleanup: LocalMediaCleanupPort = defaultCleanup) { this.configuredRoot = resolve(root); }
  public async stage(id: string, content: AsyncIterable<Uint8Array>): Promise<StagedMedia> {
    if (!blobId.test(id)) throw new Error("Invalid media blob identifier.");
    const reference = `tmp_${randomUUID().replace(/-/gu, "")}`;
    const path = await this.safePath(reference, temporaryId);
    await mkdir(dirname(path), { recursive: true });
    await this.assertSafePath(dirname(path));
    const file = await open(path, "wx"); let closed = false;
    const digest = createHash("sha256"); let sizeBytes = 0;
    try {
      for await (const chunk of content) {
        if (!(chunk instanceof Uint8Array)) throw new MediaDomainError("media_stream_invalid");
        sizeBytes += chunk.byteLength;
        if (sizeBytes > MEDIA_LIMITS.maximumBytes) throw new MediaDomainError("media_too_large");
        digest.update(chunk); await file.write(chunk);
      }
      if (sizeBytes === 0) throw new MediaDomainError("media_empty");
      await file.sync();
      return Object.freeze({ temporaryReference: reference, digest: digest.digest("hex"), sizeBytes });
    } catch (error: unknown) {
      // Windows does not permit unlinking an open file. Preserve the write failure.
      try { await this.cleanup.close(file); closed = true; } catch { closed = true; }
      await this.cleanup.remove(path).catch(() => undefined);
      throw error;
    } finally { if (!closed) await this.cleanup.close(file); }
  }
  public async readTemporary(reference: string, maximumBytes: number): Promise<Uint8Array> { return this.readReference(reference, temporaryId, maximumBytes); }
  public async promote(temporaryReference: string, id: string): Promise<string> {
    if (!temporaryId.test(temporaryReference) || !blobId.test(id)) throw new Error("Invalid media storage reference.");
    const source = await this.safePath(temporaryReference, temporaryId), targetReference = id, target = await this.safePath(targetReference, blobId);
    await mkdir(dirname(target), { recursive: true }); await this.assertSafePath(dirname(target));
    try { await rename(source, target); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await rm(source, { force: true }); }
    return targetReference;
  }
  public async delete(reference: string): Promise<void> { await rm(await this.referencePath(reference), { force: true }); }
  public async read(reference: string, maximumBytes: number): Promise<Uint8Array> { return this.readReference(reference, blobId, maximumBytes); }
  private async readReference(reference: string, expression: RegExp, maximumBytes: number): Promise<Uint8Array> {
    const path = await this.safePath(reference, expression), file = await open(path, "r");
    try { await this.assertOpenedPath(path, file); const stat = await file.stat(); if (stat.size < 1 || stat.size > maximumBytes) throw new MediaDomainError("media_integrity_invalid"); const bytes = new Uint8Array(stat.size); await file.read(bytes); return bytes; } finally { await file.close(); }
  }
  private async referencePath(reference: string): Promise<string> { return this.safePath(reference, temporaryId.test(reference) ? temporaryId : blobId); }
  private async safePath(reference: string, expression: RegExp): Promise<string> { if (!expression.test(reference) || basename(reference) !== reference) throw new Error("Invalid media storage reference."); const root = await this.root(), path = resolve(root, reference); if (!path.startsWith(`${root}${sep}`)) throw new Error("Invalid media storage path."); await this.assertSafePath(path); return path; }
  private async root(): Promise<string> { await mkdir(this.configuredRoot, { recursive: true }); const configured = await lstat(this.configuredRoot); if (!configured.isDirectory()) throw new MediaDomainError("media_unsafe_reparse"); rejectReparsePoint(configured); const root = await realpath(this.configuredRoot); const stat = await lstat(root); if (!stat.isDirectory()) throw new MediaDomainError("media_unsafe_reparse"); rejectReparsePoint(stat); return root; }
  private async assertSafePath(path: string): Promise<void> { const root = await this.root(), target = resolve(path); if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Invalid media storage path."); let current = root; for (const part of target.slice(root.length).split(sep).filter(Boolean)) { current = resolve(current, part); try { const stat = await lstat(current); rejectReparsePoint(stat); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; break; } }
  }
  /** Confirms the opened handle still names the checked file; root ownership closes the remaining API race. */
  private async assertOpenedPath(path: string, file: Awaited<ReturnType<typeof open>>): Promise<void> { const root=await this.root(), resolved=await realpath(path); if(!resolved.startsWith(`${root}${sep}`))throw new MediaDomainError("media_unsafe_reparse"); const named=await lstat(path),opened=await file.stat(); rejectReparsePoint(named); if(named.dev!==opened.dev||named.ino!==opened.ino)throw new MediaDomainError("media_unsafe_reparse"); }
}
