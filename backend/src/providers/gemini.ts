import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { AnswerGenerator, KnowledgeExtractor } from "../types/ports.js";
import { AnswerGenerationUnavailableError, assistantModelPrompt, type AssistantExecutionRequest, type AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import type { AssistantModelPort, AssistantModelRequest, AssistantModelSession, AssistantModelStep, ModelToolDeclaration, RequestedToolCall, ToolResult } from "../assistant/application/toolContracts.js";
import type { ToolSchema } from "../assistant/domain/tool.js";
import { KNOWLEDGE_EXTRACTION_PROMPT } from "./prompts.js";
import type { KnowledgeFactExtractor } from "../knowledge/application/ports.js";
import type { KnowledgeSourceKind } from "../knowledge/domain/knowledge.js";
import type { ConversationStateDerivationPort, ConversationStateOperation } from "../conversationIntelligence/application/ports.js";
import type { ConversationMessageId } from "../conversation/domain/conversation.js";

interface GeminiClient {
  readonly models: {
    generateContent(input: { model: string; contents: string; config?: { responseMimeType?: string; responseJsonSchema?: unknown; abortSignal?: AbortSignal } }): Promise<{ text?: string | undefined }>;
  };
}
interface GeminiFunctionCall { readonly id?: string; readonly name?: string; readonly args?: unknown; }
interface GeminiToolResponse { readonly text?: string; readonly functionCalls?: readonly GeminiFunctionCall[]; }
interface GeminiToolChat { sendMessage(input: { message: unknown; config?: { abortSignal?: AbortSignal } }): Promise<GeminiToolResponse>; }
interface GeminiToolClient { readonly chats: { create(input: { model: string; config: { tools: readonly { functionDeclarations: readonly Record<string, unknown>[] }[] } }): GeminiToolChat; }; }

export class GeminiProvider implements AnswerGenerator, KnowledgeExtractor {
  private client: GeminiClient | null;

  public constructor(client: GeminiClient | null = null) { this.client = client; }

  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> {
    try {
      const response = await this.gemini().models.generateContent({
        model: "gemini-3.5-flash",
        contents: assistantModelPrompt(request),
      });
      const answer = response.text?.trim();
      if (!answer) return Object.freeze({ outcome: "safe_fallback", answer: request.behavior.fallbackMessage });
      return Object.freeze({
        outcome: answer === request.behavior.fallbackMessage ? "safe_fallback" : "answered",
        answer,
      });
    } catch {
      throw new AnswerGenerationUnavailableError("Answer generation is unavailable.");
    }
  }

  public async extract(
  markdown: string,
  website: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let response;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await this.gemini().models.generateContent({
        model: "gemini-3.5-flash",
        contents: `${KNOWLEDGE_EXTRACTION_PROMPT}

WEBSITE:
${website}

WEBSITE CONTENT:
${markdown}`,
        config: {
          responseMimeType: "application/json",
          ...(signal ? { abortSignal: signal } : {}),
        },
      });

      break;
    } catch (error: unknown) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: unknown }).status
        : undefined;
      const isRetryable = status === 503 || status === 429;

      if (!isRetryable || attempt === 3) {
        throw error;
      }

      const delayMs = 2000 * attempt;

      console.log(
        `Gemini ocupado. Reintento ${attempt}/3 en ${delayMs} ms...`
      );

      await abortableDelay(delayMs, signal);
    }
  }

  if (!response?.text) {
    throw new Error("Gemini returned an empty knowledge response.");
  }

  return JSON.parse(response.text) as unknown;
  }

  public toolModel(): AssistantModelPort {
    return Object.freeze({ createSession: (): AssistantModelSession => new GeminiToolAdapter(this.gemini() as unknown as GeminiToolClient).createSession() });
  }

  public gemini(): GeminiClient {
    if (!this.client) this.client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    return this.client;
  }
}

/** Provider-only translation between Atlas definitions and Gemini structured function calling. */
export class GeminiToolAdapter implements AssistantModelPort {
  public constructor(private readonly client: GeminiToolClient, private readonly model = "gemini-3.5-flash") {}
  public createSession(): AssistantModelSession {
    let chat: GeminiToolChat | null = null;
    return Object.freeze({
      start: async (request: AssistantModelRequest, signal: AbortSignal): Promise<AssistantModelStep> => {
        if(chat)throw new AnswerGenerationUnavailableError("Gemini session has already started.");
        chat=this.client.chats.create({model:this.model,config:{tools:[{functionDeclarations:request.tools.map(toGeminiDeclaration)}]}});
        return this.generate(chat,request.prompt,signal);
      },
      continue: async (toolResults: readonly ToolResult[], signal: AbortSignal): Promise<AssistantModelStep> => {
        if(!chat)throw new AnswerGenerationUnavailableError("Gemini continuation is unavailable.");
        return this.generate(chat,toolResults.map(toGeminiFunctionResponse),signal);
      },
    });
  }
  private async generate(chat: GeminiToolChat, message: string | readonly Record<string, unknown>[], signal: AbortSignal): Promise<AssistantModelStep> {
    try {
      const response = await chat.sendMessage({message,config:{abortSignal:signal}});
      const calls = (response.functionCalls ?? []).map(call => requestedCall(call));
      if (calls.length) return Object.freeze({ kind: "tool_calls", toolCalls: Object.freeze(calls) });
      const text = response.text?.trim();
      if (!text) throw new Error("Gemini returned an empty response.");
      return Object.freeze({ kind: "final", text });
    } catch (error: unknown) { if (error instanceof Error && error.message === "Gemini returned an empty response.") throw error; throw new AnswerGenerationUnavailableError("Answer generation is unavailable."); }
  }
}
function requestedCall(call: GeminiFunctionCall): RequestedToolCall { if(!call.id||!call.name) throw new AnswerGenerationUnavailableError("Gemini returned an invalid tool call."); return Object.freeze({id:call.id,toolName:call.name,input:call.args??{}}); }
function toGeminiFunctionResponse(result: ToolResult): Record<string, unknown> { return { functionResponse: { id: result.toolCallId, name: result.toolName, response: { output: result.output } } }; }
function toGeminiDeclaration(tool: ModelToolDeclaration): Record<string, unknown> { return { name: tool.name, description: tool.description, parametersJsonSchema: geminiSchema(tool.inputSchema) }; }
function geminiSchema(schema: ToolSchema): Record<string, unknown> {
  if(schema.type==="string")return {type:"string",maxLength:schema.maxLength}; if(schema.type==="number")return {type:"number"}; if(schema.type==="boolean")return {type:"boolean"}; if(schema.type==="enum")return {type:"string",enum:[...schema.values]}; if(schema.type==="array")return {type:"array",maxItems:schema.maxItems,items:geminiSchema(schema.items)};
  return {type:"object",properties:Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,geminiSchema(value)])),required:[...(schema.required??[])],additionalProperties:false};
}

export const geminiProvider = new GeminiProvider();

export class GeminiKnowledgeFactExtractor implements KnowledgeFactExtractor {
  public constructor(private readonly provider: GeminiProvider) {}
  public async extract(_kind: KnowledgeSourceKind, normalizedText: string, url: string | null, signal: AbortSignal): Promise<unknown> {
    const value = await this.provider.extract(normalizedText, url ?? "", signal);
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>, business = record.business;
    if (!business || typeof business !== "object" || Array.isArray(business)) return value;
    const fields = business as Record<string, unknown>;
    return { services: fields.services, hours: fields.hours, locations: fields.locations, faq: record.faq };
  }
}

/** Provider adapter only: the service decides when a derived memory update is accepted. */
export class GeminiConversationIntelligenceDerivation implements ConversationStateDerivationPort {
  public constructor(private readonly provider: GeminiProvider) {}
  public async derive(input: { readonly state: import("../conversationIntelligence/domain/conversationIntelligence.js").ConversationIntelligenceState | null; readonly message: { readonly id: ConversationMessageId; readonly direction: "inbound" | "outbound"; readonly content: string; readonly createdAt: string } }): Promise<readonly ConversationStateOperation[]> {
    try {
      const response = await this.provider.gemini().models.generateContent({ model: "gemini-3.5-flash", contents: `Derive bounded semantic conversation state operations. Do not state or infer company facts. Keep only customer preferences, unresolved requests, and commitments explicitly present in the message or existing state.

EXISTING STATE:\n${JSON.stringify(input.state)}\nMESSAGE:\n${JSON.stringify({ direction: input.message.direction, content: input.message.content })}`, config: { responseMimeType: "application/json", responseJsonSchema: conversationStateDeltaSchema, abortSignal: AbortSignal.timeout(5_000) } });
      const value: unknown = response.text ? JSON.parse(response.text) : null;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid conversation intelligence response.");
      const record = value as Record<string, unknown>;
      if (!Array.isArray(record.operations)) throw new Error("Invalid conversation intelligence response.");
      return Object.freeze(record.operations as ConversationStateOperation[]);
    } catch { return Object.freeze([]); }
  }
}

// This is a transport schema only. Atlas still rejects unsupported semantics at its validator boundary.
const conversationStateDeltaSchema = Object.freeze({ type: "array", maxItems: 16, items: { type: "object", required: ["kind"], properties: { kind: { type: "string", enum: ["set_fact", "remove_fact", "mark_pending", "resolve_pending", "set_active_intent", "replace_reference_group", "stale_reference_group"] }, key: { type: "string" }, value: {}, askedAt: { type: "boolean" }, groupKind: { type: "string" }, options: { type: "array", maxItems: 10, items: { type: "object", required: ["referenceId", "label", "safePayload"], properties: { referenceId: { type: "string" }, label: { type: "string" }, safePayload: {} }, additionalProperties: false } } }, additionalProperties: false } });

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    const abort = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    function finish(): void { signal?.removeEventListener("abort", abort); resolve(); }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
