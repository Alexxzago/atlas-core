import assert from "node:assert/strict";
import test from "node:test";
import { MediaDomainError } from "../media/domain/media.js";
import { S3MediaStorage } from "../media/infrastructure/s3MediaStorage.js";

const configuration = Object.freeze({ endpoint: "https://account.r2.cloudflarestorage.com", region: "auto", bucket: "atlas-media", accessKeyId: "access-key", secretAccessKey: "secret-key" });
const blobId = "mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const location = Object.freeze({ workspaceId: 12, companyId: 34 });

async function* bytes(...values: Uint8Array[]): AsyncGenerator<Uint8Array> { for (const value of values) yield value; }
async function collect(body: unknown): Promise<Uint8Array> { const chunks: Uint8Array[] = []; let length = 0; for await (const chunk of body as AsyncIterable<unknown>) { assert.ok(chunk instanceof Uint8Array); chunks.push(chunk); length += chunk.byteLength; } const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result; }

class S3Fake {
  public readonly calls: Array<{ readonly name: string; readonly input: Record<string, unknown> }> = [];
  private readonly objects = new Map<string, Uint8Array>();
  public async send(command: { readonly input: Record<string, unknown> }, _options?: { readonly abortSignal?: AbortSignal }): Promise<unknown> {
    const name = command.constructor.name, input = command.input; this.calls.push({ name, input });
    if (name === "PutObjectCommand") { this.objects.set(input.Key as string, await collect(input.Body)); return {}; }
    if (name === "CopyObjectCommand") { const source = decodeURIComponent((input.CopySource as string).slice(configuration.bucket.length + 1)); const value = this.objects.get(source); if (!value) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }); this.objects.set(input.Key as string, value); return {}; }
    if (name === "DeleteObjectCommand") { this.objects.delete(input.Key as string); return {}; }
    if (name === "GetObjectCommand") { const value = this.objects.get(input.Key as string); if (!value) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }); return { ContentLength: value.byteLength, Body: bytes(value) }; }
    throw new Error("unexpected command");
  }
}

test("EPIC047 PASS6 stores private server-owned S3 keys and returns bounded exact bytes", async () => {
  const fake = new S3Fake(), storage = new S3MediaStorage(configuration, fake), content = Uint8Array.from([1, 2, 3]);
  const staged = await storage.stage(blobId, bytes(content), location);
  assert.match(staged.temporaryReference, /^workspaces\/12\/companies\/34\/media\/mbl_[a-f0-9]{32}\/staging\/tmp_[a-f0-9]{32}$/u);
  assert.equal(staged.temporaryReference.includes("../../"), false);
  const reference = await storage.promote(staged.temporaryReference, blobId, "image/png");
  assert.equal(reference, "workspaces/12/companies/34/media/mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/object");
  assert.deepEqual(await storage.read(reference, content.byteLength), content);
  assert.deepEqual(fake.calls.map(call => call.name), ["PutObjectCommand", "CopyObjectCommand", "DeleteObjectCommand", "GetObjectCommand"]);
  assert.equal(fake.calls.every(call => call.input.Bucket === configuration.bucket), true);
  assert.equal(fake.calls[1]?.input.ContentType, "image/png");
});

test("EPIC047 PASS6 projects missing and provider failures without endpoint or credential leakage", async () => {
  const fake = new S3Fake(), storage = new S3MediaStorage(configuration, fake), reference = "workspaces/12/companies/34/media/mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/object";
  await assert.rejects(storage.read(reference, 10), (error: unknown) => error instanceof MediaDomainError && error.code === "media_not_found" && !error.message.includes(configuration.endpoint) && !error.message.includes(configuration.secretAccessKey));
  const unavailable = { send: async (): Promise<unknown> => { throw new Error("provider unavailable"); } };
  await assert.rejects(new S3MediaStorage(configuration, unavailable).delete(reference), (error: unknown) => error instanceof MediaDomainError && error.code === "media_storage_failed");
  const missingDelete = { send: async (): Promise<unknown> => { throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }); } };
  await assert.doesNotReject(new S3MediaStorage(configuration, missingDelete).delete(reference));
});

test("EPIC047 PASS6 bounds object reads before materializing bytes", async () => {
  const client = { send: async (): Promise<unknown> => ({ ContentLength: 26 * 1024 * 1024, Body: bytes(Uint8Array.of(1)) }) };
  const storage = new S3MediaStorage(configuration, client), reference = "workspaces/12/companies/34/media/mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/object";
  await assert.rejects(storage.read(reference, 25 * 1024 * 1024), (error: unknown) => error instanceof MediaDomainError && error.code === "media_integrity_invalid");
});

test("EPIC047 PASS6 cancels S3 operations at the configured bounded deadline", async () => {
  let aborted = false;
  const client = { send: async (_command: object, options?: { readonly abortSignal?: AbortSignal }): Promise<unknown> => new Promise((_, reject) => options?.abortSignal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true })) };
  const storage = new S3MediaStorage(configuration, client, 5), reference = "workspaces/12/companies/34/media/mbl_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/object";
  await assert.rejects(storage.delete(reference), (error: unknown) => error instanceof MediaDomainError && error.code === "media_storage_failed");
  assert.equal(aborted, true);
});
