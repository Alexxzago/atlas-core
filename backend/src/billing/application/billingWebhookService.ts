import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { BillingProviderKind } from "../domain/billing.js";
import { BillingWebhookRepository } from "../../repositories/billingWebhookRepository.js";
import type { AsyncBillingProviderEventRepository } from "../infrastructure/asyncBillingPersistence.js";

export interface BillingWebhookSecrets { readonly stripe: string; readonly mercadopago: string; }
type Json = Record<string, unknown>;
const webhookTimestampMaximumSkewSeconds = 300;

export class BillingWebhookService {
  public constructor(private readonly secrets: BillingWebhookSecrets, private readonly repository: BillingWebhookRepository, private readonly now: () => string = () => new Date().toISOString()) {}
  public receive(provider: BillingProviderKind, raw: Buffer, headers: Record<string, string | string[] | undefined>): "accepted" | "duplicate" | "ignored" | "invalid" {
    if (!this.validSignature(provider, raw, headers)) return "invalid";
    const event = normalize(provider, raw);
    if (!event) return "invalid";
    return this.repository.accept({ ...event, providerKind: provider, payloadDigest: createHash("sha256").update(raw).digest("hex") }, this.now());
  }

  private validSignature(provider: BillingProviderKind, raw: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const secret = provider === "stripe" ? this.secrets.stripe : this.secrets.mercadopago;
    if (!secret) return false;
    const header = headerValue(headers, provider === "stripe" ? "stripe-signature" : "x-signature");
    if (!header) return false;
    if (provider === "stripe") return stripeSignature(secret, raw, header, this.now()).some((signature) => safeEqual(signature.digest, signature.signature));
    const expected = mercadoPagoSignature(secret, raw, headers, header, this.now());
    return expected !== null && safeEqual(expected.digest, expected.signature);
  }
}

/** Async production webhook boundary. Signature validation remains local; persistence is awaited. */
export class AsyncBillingWebhookService {
  public constructor(private readonly secrets: BillingWebhookSecrets, private readonly repository: AsyncBillingProviderEventRepository, private readonly now: () => string = () => new Date().toISOString()) {}
  public async receive(provider: BillingProviderKind, raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<"accepted" | "duplicate" | "ignored" | "invalid"> {
    if (!this.validSignature(provider, raw, headers)) return "invalid";
    const event = normalize(provider, raw);
    if (!event) return "invalid";
    return this.repository.accept({ ...event, providerKind: provider, payloadDigest: createHash("sha256").update(raw).digest("hex"), billingAccountId: null }, this.now());
  }
  private validSignature(provider: BillingProviderKind, raw: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const secret = provider === "stripe" ? this.secrets.stripe : this.secrets.mercadopago;
    if (!secret) return false;
    const header = headerValue(headers, provider === "stripe" ? "stripe-signature" : "x-signature");
    if (!header) return false;
    if (provider === "stripe") return stripeSignature(secret, raw, header, this.now()).some((signature) => safeEqual(signature.digest, signature.signature));
    const expected = mercadoPagoSignature(secret, raw, headers, header, this.now());
    return expected !== null && safeEqual(expected.digest, expected.signature);
  }
}

function normalize(provider: BillingProviderKind, raw: Buffer): Omit<import("../../repositories/billingWebhookRepository.js").BillingWebhookEvent, "providerKind" | "payloadDigest"> | null {
  let payload: Json; try { payload = JSON.parse(raw.toString("utf8")) as Json; } catch { return null; }
  const eventId = text(payload.id), eventType = text(provider === "stripe" ? payload.type : payload.type ?? payload.action);
  const data = object(provider === "stripe" ? object(payload.data)?.object : payload.data) ?? object(payload);
  const objectId = text(data?.id), customerId = text(data?.customer ?? data?.payer_id), subscriptionId = text(data?.subscription ?? (eventType && isSubscriptionType(eventType) ? data?.id : undefined)), correlationToken=text(data?.client_reference_id ?? data?.external_reference);
  if (!bounded(eventId) || !bounded(eventType) || (provider === "stripe" && eventType !== "checkout.session.completed" && !eventType.startsWith("customer.subscription."))) return null;
  if (provider === "stripe" && eventType === "checkout.session.completed" && (!bounded(objectId) || !bounded(subscriptionId))) return null;
  return { providerEventId: eventId, eventType, providerObjectId: bounded(objectId) ? objectId : null, providerCustomerId: bounded(customerId) ? customerId : null, providerSubscriptionId: bounded(subscriptionId) ? subscriptionId : null, correlationToken:bounded(correlationToken)?correlationToken:null };
}
function stripeSignature(secret: string, raw: Buffer, header: string, now: string): readonly { digest: Buffer; signature: Buffer }[] { const parts=header.split(",").map(value=>value.trim()), timestamps=parts.filter(value=>value.startsWith("t=")).map(value=>value.slice(2)), signatures=parts.filter(value=>value.startsWith("v1=")).map(value=>value.slice(3)); if(timestamps.length!==1||!timestamps[0]||!freshTimestamp(timestamps[0],now)||!signatures.length)return[]; const digest=createHmac("sha256",secret).update(`${timestamps[0]}.`).update(raw).digest(); return signatures.filter(value=>/^[0-9a-f]{64}$/i.test(value)).map(value=>({digest,signature:Buffer.from(value,"hex")})); }
function mercadoPagoSignature(secret: string, raw: Buffer, headers: Record<string, string | string[] | undefined>, header: string, now: string): { digest: Buffer; signature: Buffer } | null { const values = Object.fromEntries(header.split(",").map(part => { const [key, value] = part.trim().split("=", 2); return [key, value]; })), timestamp = values.ts, signature = values.v1, requestId = headerValue(headers, "x-request-id"); if (!timestamp || !signature || !requestId || !freshTimestamp(timestamp,now) || !/^[0-9a-f]{64}$/i.test(signature)) return null; let id = ""; try { id = text(object((JSON.parse(raw.toString("utf8")) as Json).data)?.id) ?? ""; } catch { return null; } return { digest: createHmac("sha256", secret).update(`id:${id};request-id:${requestId};ts:${timestamp};`).digest(), signature: Buffer.from(signature, "hex") }; }
function freshTimestamp(value:string,now:string):boolean { if(!/^\d+$/.test(value))return false;const timestamp=Number(value),current=Math.floor(Date.parse(now)/1000);return Number.isSafeInteger(timestamp)&&Number.isSafeInteger(current)&&Math.abs(current-timestamp)<=webhookTimestampMaximumSkewSeconds; }
function safeEqual(left: Buffer, right: Buffer): boolean { return left.length === right.length && timingSafeEqual(left, right); }
function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | null { const value = headers[name]; return typeof value === "string" && value.length <= 2048 ? value : null; }
function object(value: unknown): Json | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() === value ? value : null; }
function bounded(value: string | null): value is string { return value !== null && value.length > 0 && value.length <= 200; }
function isSubscriptionType(type: string): boolean { return /subscription|preapproval/i.test(type); }
