export type VoiceAudioInspection = { readonly kind: "processable"; readonly mimeType: "audio/ogg" | "audio/wav"; readonly durationMilliseconds: number } | { readonly kind: "unsupported" };

export function inspectVoiceAudio(bytes: Uint8Array, declaredMime: string, maximumDurationMilliseconds: number): VoiceAudioInspection {
  if (!Number.isSafeInteger(maximumDurationMilliseconds) || maximumDurationMilliseconds < 1) throw new Error("Voice duration limit is invalid.");
  const mimeType: "audio/ogg" | "audio/wav" | null = declaredMime === "audio/wav" || declaredMime === "audio/ogg" ? declaredMime : null;
  const result = mimeType === "audio/wav" ? inspectWav(bytes) : mimeType === "audio/ogg" ? inspectOggOpus(bytes) : null;
  return mimeType !== null && result !== null && result <= maximumDurationMilliseconds ? Object.freeze({ kind: "processable", mimeType, durationMilliseconds: result }) : Object.freeze({ kind: "unsupported" });
}

function inspectWav(bytes: Uint8Array): number | null {
  if (bytes.length < 12 || text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 4) !== "WAVE") return null;
  let offset = 12, sampleRate = 0, channels = 0, bits = 0, dataBytes = -1, formatFound = false;
  while (offset + 8 <= bytes.length) {
    const id = text(bytes, offset, 4), size = u32(bytes, offset + 4); if (size === null) return null;
    const start = offset + 8, end = start + size; if (end > bytes.length) return null;
    if (id === "fmt ") {
      if (size < 16 || formatFound) return null;
      const format = u16(bytes, start), parsedChannels = u16(bytes, start + 2), parsedRate = u32(bytes, start + 4), parsedBits = u16(bytes, start + 14);
      if (format !== 1 || parsedChannels === null || parsedRate === null || parsedBits === null || parsedChannels < 1 || parsedChannels > 8 || parsedRate < 1 || parsedRate > 384000 || ![8, 16, 24, 32].includes(parsedBits)) return null;
      channels = parsedChannels; sampleRate = parsedRate; bits = parsedBits; formatFound = true;
    } else if (id === "data") { if (dataBytes !== -1) return null; dataBytes = size; }
    offset = end + (size % 2); if (offset > bytes.length) return null;
  }
  if (!formatFound || dataBytes < 0) return null;
  const bytesPerFrame = channels * (bits / 8), denominator = sampleRate * bytesPerFrame;
  if (!Number.isSafeInteger(bytesPerFrame) || !Number.isSafeInteger(denominator) || denominator < 1 || dataBytes % bytesPerFrame !== 0) return null;
  const milliseconds = Math.floor((dataBytes * 1000) / denominator);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : null;
}

function inspectOggOpus(bytes: Uint8Array): number | null {
  let offset = 0, opus = false, finalGranule = -1;
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || text(bytes, offset, 4) !== "OggS" || bytes[offset + 4] !== 0) return null;
    const segments = bytes[offset + 26]!; const tableEnd = offset + 27 + segments; if (tableEnd > bytes.length) return null;
    let body = 0; for (let index = offset + 27; index < tableEnd; index += 1) body += bytes[index]!;
    const end = tableEnd + body; if (!Number.isSafeInteger(body) || end > bytes.length) return null;
    const granule = u64(bytes, offset + 6); if (granule === null) return null;
    if (!opus && body >= 8 && text(bytes, tableEnd, 8) === "OpusHead") opus = true;
    if (opus && granule >= 0) finalGranule = granule;
    offset = end;
  }
  if (!opus || finalGranule < 0) return null;
  const milliseconds = Math.floor((finalGranule * 1000) / 48000);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 ? milliseconds : null;
}

function text(bytes: Uint8Array, offset: number, length: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
function u16(bytes: Uint8Array, offset: number): number | null { return offset + 2 <= bytes.length ? bytes[offset]! | (bytes[offset + 1]! << 8) : null; }
function u32(bytes: Uint8Array, offset: number): number | null { return offset + 4 <= bytes.length ? (bytes[offset]! + bytes[offset + 1]! * 0x100 + bytes[offset + 2]! * 0x10000 + bytes[offset + 3]! * 0x1000000) : null; }
function u64(bytes: Uint8Array, offset: number): number | null { if (offset + 8 > bytes.length) return null; let value = 0; for (let index = 7; index >= 0; index -= 1) value = value * 256 + bytes[offset + index]!; return Number.isSafeInteger(value) ? value : null; }
