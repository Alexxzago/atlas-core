import { productionAssistantCapabilityCatalog } from "../../assistant/domain/assistantCapability.js";
import type { ToolDefinition } from "../../assistant/domain/tool.js";
import { liveDataObservationReference, type LiveDataService } from "../services/liveDataService.js";

/** The model receives only this bounded, provider-neutral contract. */
export function liveDataReadToolDefinition(service: LiveDataService): ToolDefinition {
  const definition: ToolDefinition = {
    name: "live_data.read",
    description: "Reads a currently configured live observation for a customer query.",
    inputSchema: { type: "object", maxProperties: 1, required: ["query"], properties: { query: { type: "string", maxLength: 500 } } },
    outputSchema: { type: "object", maxProperties: 7, required: ["status", "summary", "source", "observedAt", "fetchedAt", "expiresAt", "freshness"], properties: { status: { type: "enum", values: ["confirmed", "empty", "not_found", "unavailable"] }, summary: { type: "string", maxLength: 8_000, nullable: true }, source: { type: "string", maxLength: 200, nullable: true }, observedAt: { type: "string", maxLength: 40 }, fetchedAt: { type: "string", maxLength: 40 }, expiresAt: { type: "string", maxLength: 40 }, freshness: { type: "enum", values: ["fresh", "stale", "expired"] } } },
    requiredCapabilities: [productionAssistantCapabilityCatalog.require("live_data.read")],
    operationClass: "read",
    timeoutMilliseconds: 10_000,
    idempotencyPolicy: "not_applicable",
    confirmationPolicy: "none",
    auditPolicy: { inputFields: ["query"], outputFields: ["status", "source", "observedAt", "fetchedAt", "expiresAt", "freshness"] },
    integration: { provider: "live_data", kind: "observation" },
    liveData: { provider: "live_data", kind: "observation" },
    outputReference: liveDataObservationReference,
    conversationMemoryPolicy: { maximumBytes: 1_024, projectResult: projectFreshConfirmedMemory },
    executor: async (context, input, signal) => service.read({ workspaceId: context.workspaceId, workspaceKey: "runtime" }, context.companyId, { kind: "observation", query: (input as { readonly query: string }).query, ...(context.toolTraceId ? { toolTraceId: context.toolTraceId } : {}) }, signal),
  };
  return Object.freeze(definition);
}

function projectFreshConfirmedMemory(output: unknown): unknown | null {
  if (!output || typeof output !== "object") return null;
  const value = output as Record<string, unknown>;
  if (value.status !== "confirmed" || value.freshness !== "fresh" || typeof value.summary !== "string" || typeof value.source !== "string" || typeof value.observedAt !== "string" || typeof value.fetchedAt !== "string" || typeof value.expiresAt !== "string") return null;
  return Object.freeze({ summary: value.summary, provenance: Object.freeze({ source: value.source, observedAt: value.observedAt, fetchedAt: value.fetchedAt, expiresAt: value.expiresAt }) });
}
