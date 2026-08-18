import type { AssistantCapabilityKey } from "../domain/assistantCapability.js";
import type { ToolDefinition, ToolSchema } from "../domain/tool.js";

export interface RequestedToolCall { readonly id: string; readonly toolName: string; readonly input: unknown; }
export interface ToolResult { readonly toolCallId: string; readonly toolName: string; readonly output: unknown; }
export interface ModelToolDeclaration { readonly name: string; readonly description: string; readonly inputSchema: ToolSchema; }
export type AssistantModelStep = { readonly kind: "final"; readonly text: string } | { readonly kind: "tool_calls"; readonly toolCalls: readonly RequestedToolCall[] };
export interface AssistantModelRequest {
  readonly prompt: string; readonly tools: readonly ModelToolDeclaration[];
}
/** A session keeps provider response state opaque to application code. */
export interface AssistantModelSession {
  start(request: AssistantModelRequest, signal: AbortSignal): Promise<AssistantModelStep>;
  continue(toolResults: readonly ToolResult[], signal: AbortSignal): Promise<AssistantModelStep>;
}
export interface AssistantModelPort { createSession(): AssistantModelSession; }
export interface ToolAvailabilityPolicy { isAvailable(definition: ToolDefinition, context: { readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string }): Promise<boolean>; }
export class NoIntegrationToolAvailabilityPolicy implements ToolAvailabilityPolicy {
  public async isAvailable(_definition: ToolDefinition, _context: { readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string }): Promise<boolean> { return true; }
}
export interface AssistantProfileCapabilityRepositoryPort {
  listForProfile(context: { readonly workspaceId: number }, companyId: number, profileId: string): Promise<readonly AssistantCapabilityKey[]>;
  existsForProfile(context: { readonly workspaceId: number }, companyId: number, profileId: string): Promise<boolean>;
  replaceForProfile(context: { readonly workspaceId: number }, companyId: number, profileId: string, capabilities: readonly AssistantCapabilityKey[], actorUserId: string, at: string): Promise<boolean>;
}
export type ToolTraceState = "requested" | "completed" | "failed";
export interface ToolExecutionTrace { readonly id: string; readonly assistantExecutionRecordId: string; readonly modelToolCallId: string; readonly toolName: string; readonly state: ToolTraceState; }
export interface ToolExecutionTraceRepositoryPort {
  createRequested(value: ToolExecutionTrace & { readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string; readonly auditInput: unknown; readonly requestedAt: string }): Promise<ToolExecutionTrace>;
  complete(id: string, expectedState: "requested", value: { readonly auditOutput: unknown; readonly outputReference?: string | null; readonly completedAt: string; readonly durationMilliseconds: number }): Promise<boolean>;
  fail(id: string, expectedState: "requested", value: { readonly errorCode: string; readonly completedAt: string; readonly durationMilliseconds: number }): Promise<boolean>;
}
