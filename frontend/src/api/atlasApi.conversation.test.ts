// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { atlasApi } from "./atlasApi";

const response = (body: unknown): Response => new Response(JSON.stringify(body), { status: 201, headers: { "content-type": "application/json" } });
const message = { messageId: "cmsg_0123456789abcdef0123456789abcdef", message: { messageId: "cmsg_0123456789abcdef0123456789abcdef", content: "hola", createdAt: "2026-01-01T00:00:01.000Z" }, delivery: { id: "odl_0123456789abcdef0123456789abcdef", state: "pending" } };

afterEach(() => vi.restoreAllMocks());

test("consumes the exact operator message HTTP success contract", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response(message));
  await expect(atlasApi.sendConversationMessage("csrf", "workspace", 1, "conversation", "hola", "key")).resolves.toEqual(message);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/workspaces/workspace/companies/1/conversations/conversation/messages");
});

test("rejects a successful but incomplete operator message response", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ messageId: message.messageId, delivery: message.delivery }));
  await expect(atlasApi.sendConversationMessage("csrf", "workspace", 1, "conversation", "hola", "key")).rejects.toMatchObject({ status: 502 });
});
