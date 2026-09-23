import assert from "node:assert/strict";
import test from "node:test";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { runWhatsAppRecoveryCycle } from "../whatsapp/services/whatsAppRecoveryCycle.js";

test("EPIC056 zero-media recovery skips only inbound media while preserving non-media recovery", async () => {
  const calls: string[] = [];
  const dependencies = {
    executeProactive: async () => { calls.push("proactive"); },
    recoverInboundMedia: async () => { calls.push("media"); },
    recoverAtlasMedia: async () => { calls.push("durable-media"); },
    resumeIncomplete: async () => { calls.push("resume"); },
    dispatchOutbound: async () => { calls.push("dispatch"); },
    recoverVoiceSemantics: async () => { calls.push("voice"); },
    recoverProactiveSemantics: async () => { calls.push("proactive-semantics"); },
  };
  await runWhatsAppRecoveryCycle(false, dependencies);
  assert.deepEqual(calls, ["proactive", "resume", "dispatch", "voice", "proactive-semantics"]);
  calls.length = 0;
  await runWhatsAppRecoveryCycle(true, dependencies);
  assert.deepEqual(calls, ["proactive", "media", "durable-media", "resume", "dispatch", "voice", "proactive-semantics"]);
});

test("EPIC056 voice playback is registered only when the composed capability supplies it", () => {
  const paths = (playback: boolean): readonly string[] => {
    const router = createAuthorizedCompaniesRouter({ controllers: {} as never, assistantControllers: {} as never, authentication: {} as never, users: {} as never, authorization: {} as never, resolver: {} as never, conversationReadControllers: { list: () => (() => undefined) as never, get: () => (() => undefined) as never, ...(playback ? { playback: () => (() => undefined) as never } : {}) } });
    return ((router as unknown as { stack: Array<{ route?: { path?: string } }> }).stack).flatMap(layer => layer.route?.path === undefined ? [] : [layer.route.path]);
  };
  const playbackPath = "/:workspaceId/companies/:companyId/conversations/:conversationId/messages/:messageId/voice/playback";
  assert.equal(paths(false).includes(playbackPath), false);
  assert.equal(paths(true).includes(playbackPath), true);
});
