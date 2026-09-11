// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ConversationInbox } from "./ConversationInbox";

const item = {
  conversationId: "conversation-safe",
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
  preview: "Hello",
  deliveryCategory: null,
  lastActivityAt: "2026-01-01T00:00:00Z",
  delivery: null,
  unreadCount: 0,
};
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const inbox = <T,>(items: T[]) => ({ items, nextCursor: null });
const feed = (
  nextCursor: string,
  events: unknown[] = [],
  hasMore = false,
  resyncRequired = false,
) => ({ events, nextCursor, hasMore, resyncRequired });
const view = (
  workspaceId = "workspace",
  companyId = 1,
  capabilities: readonly (
    "company:read" | "conversation:manage" | "conversation:message:send"
  )[] = ["company:read", "conversation:manage"],
): React.JSX.Element => (
  <I18nProvider>
    <ConversationInbox
      csrf="csrf"
      workspaceId={workspaceId}
      companyId={companyId}
      capabilities={capabilities}
    />
  </I18nProvider>
);
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.removeItem("atlas.locale");
});

test("bootstraps feed tail before authoritative list and catches an event in the first poll", async () => {
  vi.useFakeTimers();
  const calls: string[] = [],
    fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/feed"))
        return Promise.resolve(
          json(
            calls.filter((call) => call.includes("/feed")).length === 1
              ? feed("tail")
              : feed("next", [
                  {
                    eventId: "event",
                    type: "assistant_message_created",
                    conversationId: item.conversationId,
                    occurredAt: "2026-01-01T00:00:01Z",
                    controlVersion: 1,
                    authorityGeneration: 1,
                    relatedMessageId: null,
                  },
                ]),
          ),
        );
      if (url.endsWith("/conversations")) return Promise.resolve(json(inbox([item])));
      return Promise.resolve(json(item));
    });
  vi.stubGlobal("fetch", fetch);
  render(view());
  await flush();
  expect(screen.getByText("Customer")).toBeTruthy();
  expect(calls[0]).toContain("/conversations/feed");
  expect(calls[1]).toMatch(/\/conversations$/);
  await vi.advanceTimersByTimeAsync(3_000);
  await flush();
  expect(calls.filter((call) => call.includes("after=tail")).length).toBe(1);
  expect(calls.filter((call) => call.endsWith("/conversations")).length).toBe(
    2,
  );
});

test("pauses hidden polling, resumes after an aborted request settles, and never overlaps a pending request", async () => {
  vi.useFakeTimers();
  let resolvePoll!: (response: Response) => void,
    feedCalls = 0;
  const fetch = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/feed")) {
      feedCalls += 1;
      if (feedCalls === 1) return Promise.resolve(json(feed("tail")));
      return new Promise<Response>((resolve) => {
        resolvePoll = resolve;
      });
    }
    if (url.endsWith("/conversations")) return Promise.resolve(json(inbox([item])));
    return Promise.resolve(json(item));
  });
  vi.stubGlobal("fetch", fetch);
  render(view());
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(feedCalls).toBe(2);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(feedCalls).toBe(2);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(feedCalls).toBe(2);
  resolvePoll(json(feed("next")));
  await flush();
  expect(feedCalls).toBe(3);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(feedCalls).toBe(3);
});

test("backs off transient feed failures and resets cadence after success", async () => {
  vi.useFakeTimers();
  let feeds = 0;
  const fetch = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/feed")) {
      feeds += 1;
      return feeds === 1
        ? Promise.resolve(json(feed("tail")))
        : feeds === 2
          ? Promise.reject(new TypeError("offline"))
          : Promise.resolve(json(feed("tail")));
    }
    if (url.endsWith("/conversations")) return Promise.resolve(json(inbox([item])));
    return Promise.resolve(json(item));
  });
  vi.stubGlobal("fetch", fetch);
  render(view());
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  await flush();
  expect(feeds).toBe(2);
  await vi.advanceTimersByTimeAsync(5_999);
  expect(feeds).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  await flush();
  expect(feeds).toBe(3);
  await vi.advanceTimersByTimeAsync(3_000);
  await flush();
  expect(feeds).toBe(4);
});

test("drains pages immediately and resync discards incremental events before a new tail bootstrap", async () => {
  vi.useFakeTimers();
  const feeds = [
    feed("tail"),
    feed(
      "page-1",
      [
        {
          eventId: "one",
          type: "operator_message_created",
          conversationId: item.conversationId,
          occurredAt: "2026-01-01T00:00:01Z",
          controlVersion: 1,
          authorityGeneration: 1,
          relatedMessageId: null,
        },
      ],
      true,
    ),
    feed("page-2", [
      {
        eventId: "two",
        type: "assistant_message_created",
        conversationId: item.conversationId,
        occurredAt: "2026-01-01T00:00:02Z",
        controlVersion: 1,
        authorityGeneration: 1,
        relatedMessageId: null,
      },
    ]),
    feed("fresh", [], false, true),
    feed("reboot"),
  ];
  let index = 0,
    listCalls = 0;
  const fetch = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/feed")) return Promise.resolve(json(feeds[index++]!));
    if (url.endsWith("/conversations")) {
      listCalls += 1;
      return Promise.resolve(json(inbox([item])));
    }
    return Promise.resolve(json(item));
  });
  vi.stubGlobal("fetch", fetch);
  render(view());
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  await flush();
  expect(index).toBe(3);
  expect(listCalls).toBe(2);
  await vi.advanceTimersByTimeAsync(3_000);
  await flush();
  expect(index).toBe(5);
  expect(listCalls).toBe(3);
});

test("aborts obsolete company and workspace feed requests without applying old scope", async () => {
  let oldSignal: AbortSignal | undefined;
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("companies/1/conversations/feed")) {
      oldSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }
    if (url.includes("/feed")) return Promise.resolve(json(feed("new-tail")));
    if (url.endsWith("/conversations"))
      return Promise.resolve(
        json(inbox([{ ...item, contactLabel: "Current company", participant: "Current company" }])),
      );
    return Promise.resolve(json(item));
  });
  vi.stubGlobal("fetch", fetch);
  const rendered = render(view("workspace-a", 1));
  rendered.rerender(view("workspace-b", 2));
  expect(await screen.findByText("Current company")).toBeTruthy();
  expect(oldSignal?.aborted).toBe(true);
  rendered.unmount();
  expect(oldSignal?.aborted).toBe(true);
});

test("explains that Atlas is paused and offers takeover or direct reactivation", async () => {
  window.localStorage.setItem("atlas.locale", "es");
  const required = { ...item, controlState: "human_required" as const, attentionReason: "automation_failure" as const, messages: [] };
  const fetch = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/feed")) return Promise.resolve(json(feed("tail")));
    if (url.endsWith("/conversations")) return Promise.resolve(json(inbox([required])));
    return Promise.resolve(json(required));
  });
  vi.stubGlobal("fetch", fetch);
  render(view());
  fireEvent.click(await screen.findByText("Customer"));
  expect(await screen.findByText(/Atlas está pausado en esta conversación/)).toBeTruthy();
  expect(screen.getByText(/Los mensajes nuevos del cliente seguirán llegando a la bandeja/)).toBeTruthy();
  expect(screen.getByText(/Tomá la conversación para revisarla o reactivá Atlas/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tomar esta conversación" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reactivar Atlas" })).toBeTruthy();
});

test("reactivation posts a durable resume operation and updates the selected control", async () => {
  const required = { ...item, controlState: "human_required" as const, attentionReason: "automation_failure" as const, messages: [] };
  const resumed = { ...required, controlState: "automated" as const, attentionReason: null, controlVersion: 2, authorityGeneration: 2 };
  let resumeBody = "", isResumed = false;
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/feed")) return Promise.resolve(json(feed("tail")));
    if (url.endsWith("/conversations")) return Promise.resolve(json(inbox([required])));
    if (url.includes("/resume")) { resumeBody = String(init?.body); isResumed = true; return Promise.resolve(json({ control: resumed })); }
    if (url.endsWith("/conversation-safe")) return Promise.resolve(json(isResumed ? resumed : required));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", fetch);
  render(view());
  fireEvent.click(await screen.findByText("Customer"));
  fireEvent.click(await screen.findByRole("button", { name: "Reactivate Atlas" }));
  await waitFor(() => expect(resumeBody).not.toBe(""));
  const resume = JSON.parse(resumeBody) as { expectedVersion: number; operationId: string };
  expect(resume.expectedVersion).toBe(1);
  expect(resume.operationId.length).toBeGreaterThan(0);
  await screen.findByRole("button", { name: "Take over this conversation" });
});

test("takeover sends a durable operation id and the current controller can still send", async () => {
  const controlled = {
    ...item,
    controlState: "human_controlled" as const,
    controlledByCurrentActor: true,
    messages: [],
  };
  let takeoverBody = "",
    sent = false,
    taken = false;
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/feed")) return Promise.resolve(json(feed("tail")));
    if (url.endsWith("/conversations")) return Promise.resolve(json(inbox([item])));
    if (url.endsWith("/conversation-safe"))
      return Promise.resolve(
        json(taken ? controlled : { ...item, messages: [] }),
      );
    if (url.includes("/takeover")) {
      takeoverBody = String(init?.body);
      taken = true;
      return Promise.resolve(json({ control: controlled }));
    }
    if (url.includes("/messages")) {
      sent = true;
      return Promise.resolve(
        json({
          messageId: "message",
          delivery: { id: "delivery", state: "pending" },
        }),
      );
    }
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", fetch);
  render(
    view("workspace", 1, [
      "company:read",
      "conversation:manage",
      "conversation:message:send",
    ]),
  );
  fireEvent.click(await screen.findByText("Customer"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Take over this conversation" }),
  );
  await screen.findByRole("textbox", { name: "Your reply" });
  const takeover = JSON.parse(takeoverBody) as {
    expectedVersion: number;
    operationId: string;
  };
  expect(takeover.expectedVersion).toBe(1);
  expect(takeover.operationId.length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole("textbox", { name: "Your reply" }), {
    target: { value: "Reply" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
  await waitFor(() => expect(sent).toBe(true));
});

test("uses stable operation ids for retries, new ids for new actions, and hides controller actions for another actor", async () => {
  const controlled = {
    ...item,
    controlState: "human_controlled" as const,
    controlledByCurrentActor: true,
    messages: [],
  };
  let mutationBodies: string[] = [],
    attempts = 0;
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/feed")) return Promise.resolve(json(feed("tail")));
    if (url.endsWith("/conversations"))
      return Promise.resolve(json(inbox([controlled])));
    if (url.endsWith("/conversation-safe"))
      return Promise.resolve(json(controlled));
    if (url.includes("/resolve")) {
      mutationBodies.push(String(init?.body));
      attempts += 1;
      return Promise.resolve(json({}, attempts === 1 ? 500 : 200));
    }
    if (url.includes("/release")) {
      mutationBodies.push(String(init?.body));
      return Promise.resolve(json({ control: { ...controlled } }));
    }
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", fetch);
  render(view());
  fireEvent.click(await screen.findByText("Customer"));
  await screen.findByRole("button", {
    name: "Return this conversation to Atlas",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Return this conversation to Atlas" }),
  );
  await screen.findByText("We could not load this conversation.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("button", {
    name: "Return this conversation to Atlas",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Return this conversation to Atlas" }),
  );
  await waitFor(() => expect(mutationBodies.length).toBe(2));
  expect(JSON.parse(mutationBodies[0]!).operationId).toBe(
    JSON.parse(mutationBodies[1]!).operationId,
  );
  const otherFetch = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/feed")) return Promise.resolve(json(feed("tail")));
    if (url.endsWith("/conversations"))
      return Promise.resolve(
        json(inbox([{ ...controlled, controlledByCurrentActor: false }])),
      );
    return Promise.resolve(
      json({ ...controlled, controlledByCurrentActor: false }),
    );
  });
  cleanup();
  vi.stubGlobal("fetch", otherFetch);
  render(view());
  fireEvent.click(await screen.findByText("Customer"));
  await screen.findByText("Who is responding");
  expect(
    screen.queryByRole("button", { name: "Return this conversation to Atlas" }),
  ).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Your reply" })).toBeNull();
});
