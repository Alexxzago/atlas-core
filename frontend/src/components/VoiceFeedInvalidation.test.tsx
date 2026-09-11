// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ConversationInbox } from "./ConversationInbox";

const item = {
  conversationId: "conversation",
  channel: "whatsapp" as const,
  state: "open" as const,
  controlState: "automated" as const,
  controlledByCurrentActor: false,
  attentionReason: null,
  takenAt: null,
  releasedAt: null,
  lastOperatorActivityAt: null,
  resolvedAt: null,
  controlVersion: 1,
  updatedAt: "2026-01-01T00:00:00Z",
  contactLabel: "Customer",
  participant: "Customer",
  preview: "[audio]",
  deliveryCategory: "received" as const,
  lastActivityAt: "2026-01-01T00:00:00Z",
  delivery: null,
};
const detail = {
  ...item,
  messages: [
    {
      messageId: "voice",
      participant: "masked",
      deliveryCategory: "received" as const,
      content: "[audio]",
      createdAt: "2026-01-01T00:00:00Z",
      delivery: null,
      voiceAvailable: true,
    },
  ],
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test("refetches only the affected Voice read model for duplicate feed events", async () => {
  vi.useFakeTimers();
  let feedCalls = 0,
    voiceCalls = 0,
    listCalls = 0;
  const fetch = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/feed")) {
      feedCalls += 1;
      return Promise.resolve(
        json(
          feedCalls === 1
            ? {
                events: [],
                nextCursor: "tail",
                hasMore: false,
                resyncRequired: false,
              }
            : {
                events: [
                  {
                    eventId: `voice-${feedCalls}`,
                    type: "voice_state_changed",
                    conversationId: "conversation",
                    occurredAt: "2026-01-01T00:00:01Z",
                    controlVersion: null,
                    authorityGeneration: null,
                    relatedMessageId: "voice",
                  },
                  {
                    eventId: `voice-repeat-${feedCalls}`,
                    type: "voice_state_changed",
                    conversationId: "conversation",
                    occurredAt: "2026-01-01T00:00:02Z",
                    controlVersion: null,
                    authorityGeneration: null,
                    relatedMessageId: "voice",
                  },
                ],
                nextCursor: "next",
                hasMore: false,
                resyncRequired: false,
              },
        ),
      );
    }
    if (url.endsWith("/conversations")) {
      listCalls += 1;
      return Promise.resolve(json({ items: [item], nextCursor: null }));
    }
    if (url.endsWith("/conversation")) return Promise.resolve(json(detail));
    if (url.includes("/messages/voice/voice")) {
      voiceCalls += 1;
      return Promise.resolve(
        json({
          messageId: "voice",
          direction: "inbound",
          modality: "audio",
          transcript: voiceCalls > 1 ? "Updated" : "Initial",
          transcriptLanguageTag: null,
          transcriptionState: "completed",
          deferredState: null,
          fallbackAvailable: false,
          playbackAvailable: false,
        }),
      );
    }
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <I18nProvider>
      <ConversationInbox
        csrf="csrf"
        workspaceId="workspace"
        companyId={1}
        capabilities={["company:read"]}
      />
    </I18nProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText("Customer")).toBeTruthy();
  fireEvent.click(screen.getByText("Customer"));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText("Initial")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText("Updated")).toBeTruthy();
  expect(voiceCalls).toBe(2);
  expect(listCalls).toBe(1);
});
