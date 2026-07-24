const apiBaseUrl = (import.meta.env?.VITE_ATLAS_API_BASE_URL ?? "/api").replace(/\/$/, "");

export class PublicWebChatApiError extends Error {
  public constructor(public readonly status: number) { super("Public Web Chat request failed."); }
}

function path(connectionPublicId: string, suffix: "session" | "messages"): string {
  return `${apiBaseUrl}/public/web-chat/${encodeURIComponent(connectionPublicId)}/${suffix}`;
}

async function request<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: "same-origin" });
  if (!response.ok) throw new PublicWebChatApiError(response.status);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const publicWebChatApi = {
  startSession: (connectionPublicId: string): Promise<void> => request(path(connectionPublicId, "session"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  sendMessage: (connectionPublicId: string, message: string): Promise<{ message: string }> => request(path(connectionPublicId, "messages"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) }),
  closeSession: (connectionPublicId: string): Promise<void> => request(path(connectionPublicId, "session"), { method: "DELETE" }),
};
