import assert from "node:assert/strict";
import test from "node:test";
import { inspectVoiceAudio } from "../whatsapp/domain/audioInspection.js";
import { FakeSpeechTranscriptionProvider } from "./support/fakeSpeechTranscriptionProvider.js";
import { FakeSpeechSynthesisProvider } from "./support/fakeSpeechSynthesisProvider.js";

function wav(dataBytes: number): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes), view = new DataView(bytes.buffer);
  bytes.set(Buffer.from("RIFF"), 0); view.setUint32(4, 36 + dataBytes, true); bytes.set(Buffer.from("WAVEfmt "), 8); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); bytes.set(Buffer.from("data"), 36); view.setUint32(40, dataBytes, true);
  return bytes;
}

function oggOpus(granule = 48_000): Uint8Array {
  const bytes = new Uint8Array(27 + 1 + 8), view = new DataView(bytes.buffer);
  bytes.set(Buffer.from("OggS")); bytes[4] = 0; view.setUint32(6, granule, true); view.setUint32(10, 0, true);
  bytes[26] = 1; bytes[27] = 8; bytes.set(Buffer.from("OpusHead"), 28);
  return bytes;
}

test("EPIC044 PASS3A inspector accepts only bounded PCM WAV and Ogg Opus", () => {
  assert.deepEqual(inspectVoiceAudio(wav(16_000), "audio/wav", 2_000), { kind: "processable", mimeType: "audio/wav", durationMilliseconds: 1_000 });
  assert.deepEqual(inspectVoiceAudio(oggOpus(), "audio/ogg", 2_000), { kind: "processable", mimeType: "audio/ogg", durationMilliseconds: 1_000 });
  assert.deepEqual(inspectVoiceAudio(wav(16_000), "audio/ogg", 2_000), { kind: "unsupported" });
  assert.deepEqual(inspectVoiceAudio(oggOpus(), "audio/wav", 2_000), { kind: "unsupported" });
  assert.deepEqual(inspectVoiceAudio(wav(32_000), "audio/wav", 1_000), { kind: "unsupported" });
  assert.deepEqual(inspectVoiceAudio(wav(10).subarray(0, 42), "audio/wav", 2_000), { kind: "unsupported" });
  assert.deepEqual(inspectVoiceAudio(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), "audio/ogg", 2_000), { kind: "unsupported" });
  assert.deepEqual(inspectVoiceAudio(new Uint8Array([...oggOpus().subarray(0, 28), ...Buffer.from("NotOpus!")]), "audio/ogg", 2_000), { kind: "unsupported" });
  const overflowing = oggOpus(); overflowing.fill(0xff, 6, 14);
  assert.deepEqual(inspectVoiceAudio(overflowing, "audio/ogg", 2_000), { kind: "unsupported" });
  assert.deepEqual(inspectVoiceAudio(new Uint8Array([0x49, 0x44, 0x33]), "audio/mpeg", 2_000), { kind: "unsupported" });
});

test("EPIC044 PASS5A deterministic TTS fake remains provider-neutral", async () => {
  const fake = new FakeSpeechSynthesisProvider({ kind: "completed", audio: oggOpus(), mimeType: "audio/ogg" });
  assert.deepEqual(await fake.synthesize({ text: "hola", signal: new AbortController().signal }), { kind: "completed", audio: oggOpus(), mimeType: "audio/ogg" });
  const aborted = new AbortController(); aborted.abort();
  assert.deepEqual(await fake.synthesize({ text: "hola", signal: aborted.signal }), { kind: "retryable", safeFailureCategory: "timeout" });
});

test("EPIC044 PASS3A deterministic STT fake remains provider-neutral", async () => {
  const fake = new FakeSpeechTranscriptionProvider({ kind: "completed", transcript: "hola", languageTag: "es" });
  assert.deepEqual(await fake.transcribe({ audio: wav(0), mimeType: "audio/wav", durationMilliseconds: 0, signal: new AbortController().signal }), { kind: "completed", transcript: "hola", languageTag: "es" });
  const aborted = new AbortController(); aborted.abort();
  assert.deepEqual(await fake.transcribe({ audio: wav(0), mimeType: "audio/wav", durationMilliseconds: 0, signal: aborted.signal }), { kind: "retryable", safeFailureCategory: "timeout" });
});
