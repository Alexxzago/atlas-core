import type { AssistantCapabilityKey } from "./assistantCapability.js";

export type ToolOperationClass = "read" | "write" | "sensitive_write";
export type ToolConfirmationPolicy = "none" | "user" | "operator";
export type ToolIdempotencyPolicy = "not_applicable" | "source_owned_required";
export type ToolScalarSchema = { readonly type: "string"; readonly maxLength: number; readonly nullable?: boolean }
  | { readonly type: "number"; readonly nullable?: boolean }
  | { readonly type: "boolean"; readonly nullable?: boolean }
  | { readonly type: "enum"; readonly values: readonly string[]; readonly nullable?: boolean };
export type ToolSchema = ToolScalarSchema | {
  readonly type: "array"; readonly items: ToolSchema; readonly maxItems: number; readonly nullable?: boolean;
} | {
  readonly type: "object"; readonly properties: Readonly<Record<string, ToolSchema>>; readonly required?: readonly string[];
  readonly maxProperties: number; readonly nullable?: boolean;
};

export interface ToolAuditPolicy { readonly inputFields?: readonly string[]; readonly outputFields?: readonly string[]; }
export interface ToolConfirmation { readonly kind: "user" | "operator"; readonly confirmationId: string; }
export interface ToolExecutionContext {
  readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string;
  readonly assistantExecutionRecordId: string; readonly conversationId: string | null;
  readonly channel: "whatsapp" | "web_chat" | "internal"; readonly invocationId: string;
  readonly idempotencyKey: string | null; readonly confirmation: ToolConfirmation | null;
}
export interface ToolDefinition {
  readonly name: string; readonly description: string; readonly inputSchema: ToolSchema; readonly outputSchema: ToolSchema;
  readonly requiredCapabilities: readonly AssistantCapabilityKey[]; readonly operationClass: ToolOperationClass;
  readonly timeoutMilliseconds: number; readonly idempotencyPolicy: ToolIdempotencyPolicy;
  readonly confirmationPolicy: ToolConfirmationPolicy; readonly auditPolicy: ToolAuditPolicy;
  readonly executor: (context: ToolExecutionContext, input: unknown, signal: AbortSignal) => Promise<unknown>;
}
export class ToolSchemaError extends Error {}

export function validateToolSchema(schema: ToolSchema, value: unknown, depth = 0): unknown {
  if (depth > 6) throw new ToolSchemaError("Tool value is too deeply nested.");
  if (value === null && schema.nullable) return null;
  if (schema.type === "string") {
    if (typeof value !== "string" || Array.from(value).length > schema.maxLength) throw new ToolSchemaError("Tool string is invalid.");
    return value;
  }
  if (schema.type === "number") { if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolSchemaError("Tool number is invalid."); return value; }
  if (schema.type === "boolean") { if (typeof value !== "boolean") throw new ToolSchemaError("Tool boolean is invalid."); return value; }
  if (schema.type === "enum") { if (typeof value !== "string" || !schema.values.includes(value)) throw new ToolSchemaError("Tool enum is invalid."); return value; }
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > schema.maxItems) throw new ToolSchemaError("Tool array is invalid.");
    return Object.freeze(value.map((item) => validateToolSchema(schema.items, item, depth + 1)));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ToolSchemaError("Tool object is invalid.");
  const record = value as Record<string, unknown>, keys = Object.keys(record), properties = schema.properties;
  if (keys.length > schema.maxProperties || keys.some((key) => !(key in properties))) throw new ToolSchemaError("Tool object has unsupported properties.");
  for (const key of schema.required ?? []) if (!(key in record)) throw new ToolSchemaError("Tool object is missing a required property.");
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const property = properties[key];
    if (!property) throw new ToolSchemaError("Tool property is invalid.");
    output[key] = validateToolSchema(property, record[key], depth + 1);
  }
  return Object.freeze(output);
}
