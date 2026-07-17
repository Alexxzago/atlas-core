export type AssistantPreviewErrorKey = "preview.profileUnavailable" | "preview.companyUnavailable"
  | "preview.knowledgeUnavailable" | "preview.temporarilyUnavailable" | "preview.invalid";

export type AssistantPreviewState =
  | { status: "idle"; requestId: null }
  | { status: "pending"; requestId: number }
  | { status: "answered" | "safe_fallback"; requestId: null; answer: string }
  | { status: "error"; requestId: null; key: AssistantPreviewErrorKey };

export type AssistantPreviewAction =
  | { type: "contextChanged" }
  | { type: "started"; requestId: number }
  | { type: "succeeded"; requestId: number; outcome: "answered" | "safe_fallback"; answer: string }
  | { type: "failed"; requestId: number; key: AssistantPreviewErrorKey };

export const initialAssistantPreviewState: AssistantPreviewState = { status: "idle", requestId: null };

export function assistantPreviewReducer(state: AssistantPreviewState, action: AssistantPreviewAction): AssistantPreviewState {
  if (action.type === "contextChanged") return initialAssistantPreviewState;
  if (action.type === "started") return { status: "pending", requestId: action.requestId };
  if (state.status !== "pending" || state.requestId !== action.requestId) return state;
  if (action.type === "succeeded") return { status: action.outcome, requestId: null, answer: action.answer };
  return { status: "error", requestId: null, key: action.key };
}

export function previewMessageLength(message: string): number { return Array.from(message.trim()).length; }
export function previewMessageValid(message: string): boolean { const length = previewMessageLength(message); return length >= 1 && length <= 2_000; }
export function previewAllowed(role: string | null): boolean { return role === "owner" || role === "administrator" || role === "operator"; }
export function abortPreview(controller: AbortController | null): void { controller?.abort(); }
export const assistantPreviewAccessibility = Object.freeze({ pendingRole: "status", resultLive: "polite", errorRole: "alert" } as const);
