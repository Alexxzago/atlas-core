import { ApiError } from "../api/atlasApi.ts";

export interface AssistantScope { readonly workspaceId: string; readonly companyId: number; readonly assistantProfileId: string | null; }
export type AssistantResourceStatus = "idle" | "loading" | "ready" | "empty" | "unavailable" | "forbidden" | "not_found" | "conflict" | "error";
export interface AssistantResourceState<T> { readonly scope: AssistantScope | null; readonly generation: number; readonly status: AssistantResourceStatus; readonly value: T | null; readonly pendingMutation: string | null; readonly retryAfterSeconds: number | null; }
export const initialAssistantResourceState = <T>(): AssistantResourceState<T> => ({ scope: null, generation: 0, status: "idle", value: null, pendingMutation: null, retryAfterSeconds: null });
export type AssistantResourceAction<T> = { readonly type: "scopeChanged"; readonly scope: AssistantScope } | { readonly type: "loadStarted"; readonly generation: number } | { readonly type: "loaded"; readonly generation: number; readonly value: T | null } | { readonly type: "failed"; readonly generation: number; readonly error: unknown } | { readonly type: "mutationStarted"; readonly mutation: string } | { readonly type: "mutationConfirmed"; readonly mutation: string; readonly value: T } | { readonly type: "mutationFailed"; readonly mutation: string; readonly error: unknown };

export function assistantResourceError(error: unknown): Pick<AssistantResourceState<never>, "status" | "retryAfterSeconds"> {
  if (error instanceof ApiError) {
    if (error.status === 400) return { status: "error", retryAfterSeconds: null };
    if (error.status === 404) return { status: "not_found", retryAfterSeconds: null };
    if (error.status === 409) return { status: "conflict", retryAfterSeconds: null };
    if (error.status === 429) return { status: "unavailable", retryAfterSeconds: error.retryAfterSeconds };
    if (error.status === 503) return { status: "unavailable", retryAfterSeconds: null };
    if (error.status === 403) return { status: "forbidden", retryAfterSeconds: null };
  }
  return { status: "error", retryAfterSeconds: null };
}

export function assistantResourceReducer<T>(state: AssistantResourceState<T>, action: AssistantResourceAction<T>): AssistantResourceState<T> {
  if (action.type === "scopeChanged") return { ...initialAssistantResourceState<T>(), scope: action.scope, generation: state.generation + 1 };
  if (action.type === "loadStarted") return action.generation === state.generation ? { ...state, status: "loading", retryAfterSeconds: null } : state;
  if (action.type === "loaded") return action.generation === state.generation ? { ...state, status: action.value === null ? "empty" : "ready", value: action.value, retryAfterSeconds: null } : state;
  if (action.type === "failed") return action.generation === state.generation ? { ...state, ...assistantResourceError(action.error), pendingMutation: null } : state;
  if (action.type === "mutationStarted") return state.pendingMutation === null ? { ...state, pendingMutation: action.mutation } : state;
  if (action.type === "mutationConfirmed") return state.pendingMutation === action.mutation ? { ...state, status: "ready", value: action.value, pendingMutation: null, retryAfterSeconds: null } : state;
  if (state.pendingMutation !== action.mutation) return state;
  const mapped = assistantResourceError(action.error);
  return { ...state, ...mapped, pendingMutation: null };
}
