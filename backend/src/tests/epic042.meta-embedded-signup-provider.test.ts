import assert from "node:assert/strict";
import test from "node:test";
import { MetaEmbeddedSignupConfigurationError, MetaEmbeddedSignupGraphProvider, metaEmbeddedSignupProviderFromEnvironment, validateMetaGraphApiVersion } from "../whatsapp/providers/MetaEmbeddedSignupProvider.js";

const configuration = { appId: "123456", appSecret: "server-app-secret", graphApiVersion: "v25.0" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const signal = () => new AbortController().signal;

test("EPIC-042 exchanges authorization codes only through the fixed Graph OAuth endpoint", async () => {
  let seen: { url: string; init: RequestInit | undefined } | undefined;
  const provider = new MetaEmbeddedSignupGraphProvider(configuration, async (url, init) => { seen = { url: String(url), init }; return json({ access_token: "business-token", token_type: "bearer", expires_in: 3600 }); });
  assert.deepEqual(await provider.exchangeAuthorizationCode({ authorizationCode: "browser-code", signal: signal() }), { kind: "success", credential: { accessToken: "business-token", tokenType: "bearer", expiresInSeconds: 3600 } });
  const request = new URL(seen!.url);
  assert.equal(request.origin, "https://graph.facebook.com");
  assert.equal(request.pathname, "/v25.0/oauth/access_token");
  assert.deepEqual(Object.fromEntries(request.searchParams), { client_id: "123456", client_secret: "server-app-secret", code: "browser-code" });
  assert.equal(seen!.init?.method, "GET"); assert.equal(seen!.init?.redirect, "error"); assert.ok(seen!.init?.signal);
});

test("EPIC-042 validates Graph authority, configuration completeness, and safe credential responses", async () => {
  assert.equal(validateMetaGraphApiVersion("v25.0"), "v25.0");
  for (const value of ["25.0", "v25", "v0.0", "v25.0/x"]) assert.throws(() => validateMetaGraphApiVersion(value), MetaEmbeddedSignupConfigurationError);
  assert.equal(metaEmbeddedSignupProviderFromEnvironment(undefined, undefined, undefined), null);
  assert.throws(() => metaEmbeddedSignupProviderFromEnvironment("123", undefined, "v25.0"), error => error instanceof MetaEmbeddedSignupConfigurationError && !error.message.includes("123"));
  for (const body of [{}, { access_token: "" }, { access_token: "token", expires_in: -1 }]) assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => json(body)).exchangeAuthorizationCode({ authorizationCode: "code", signal: signal() }), { kind: "invalid_response" });
  assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => new Response("not-json", { headers: { "content-type": "application/json" } })).exchangeAuthorizationCode({ authorizationCode: "code", signal: signal() }), { kind: "invalid_response" });
  for (const [http, expected] of [[401, "unauthorized"], [403, "forbidden"], [429, "rate_limited"], [503, "unavailable"]] as const) assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => json({}, http)).exchangeAuthorizationCode({ authorizationCode: "code", signal: signal() }), { kind: expected });
  const timeout = await new MetaEmbeddedSignupGraphProvider(configuration, async () => { throw new DOMException("Aborted", "AbortError"); }).exchangeAuthorizationCode({ authorizationCode: "code", signal: signal() });
  assert.deepEqual(timeout, { kind: "timeout" }); assert.doesNotMatch(JSON.stringify(timeout), /code|secret|token/i);
});

test("EPIC-042 bounds streamed OAuth responses before retaining excess bytes", async () => {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new TextEncoder().encode("12345")); if (reads === 2) controller.close(); } });
  const result = await new MetaEmbeddedSignupGraphProvider(configuration, async () => new Response(body, { headers: { "content-type": "application/json" } }), 8_000, 8).exchangeAuthorizationCode({ authorizationCode: "code", signal: signal() });
  assert.deepEqual(result, { kind: "invalid_response" }); assert.equal(reads, 2);
});

test("EPIC-042 accepts only phone assets verified under the server-verified WABA", async () => {
  const requests: string[] = [];
  const provider = new MetaEmbeddedSignupGraphProvider(configuration, async url => { requests.push(String(url)); return requests.length === 1 ? json({ id: "987654" }) : json({ data: [{ id: "111222", display_phone_number: " +1 555 0100 ", verified_name: "Atlas Realty" }] }); });
  const result = await provider.verifyAssets({ whatsappBusinessAccountId: "987654", phoneNumberId: "111222", accessToken: "business-token", signal: signal() });
  assert.deepEqual(result, { kind: "success", asset: { whatsappBusinessAccountId: "987654", phoneNumberId: "111222", displayPhoneNumber: "+1 555 0100" } });
  assert.deepEqual(requests, ["https://graph.facebook.com/v25.0/987654?fields=id", "https://graph.facebook.com/v25.0/987654/phone_numbers?fields=id%2Cdisplay_phone_number%2Cverified_name&limit=50"]);
  assert.doesNotMatch(JSON.stringify(result), /business-token|secret|raw/i);
});

test("EPIC-042 rejects browser hints without matching WABA and phone server responses", async () => {
  const verify = (waba: unknown, phones: unknown) => new MetaEmbeddedSignupGraphProvider(configuration, async url => String(url).includes("phone_numbers") ? json(phones) : json(waba)).verifyAssets({ whatsappBusinessAccountId: "987654", phoneNumberId: "111222", accessToken: "token", signal: signal() });
  assert.deepEqual(await verify({ id: "other" }, { data: [{ id: "111222" }] }), { kind: "invalid_response" });
  assert.deepEqual(await verify({ id: "987654" }, { data: [] }), { kind: "not_found" });
  assert.deepEqual(await verify({ id: "987654" }, { data: [{ id: "111222" }, { id: "111222" }] }), { kind: "invalid_response" });
  assert.deepEqual(await verify({ id: "987654" }, { data: Array.from({ length: 51 }, () => ({ id: "1" })) }), { kind: "invalid_response" });
  assert.deepEqual(await verify({ id: "987654" }, {}), { kind: "invalid_response" });
  assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => json({}, 429)).verifyAssets({ whatsappBusinessAccountId: "987654", phoneNumberId: "111222", accessToken: "token", signal: signal() }), { kind: "rate_limited" });
  assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => json({}, 503)).verifyAssets({ whatsappBusinessAccountId: "987654", phoneNumberId: "111222", accessToken: "token", signal: signal() }), { kind: "unavailable" });
  assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => json({}, 403)).verifyAssets({ whatsappBusinessAccountId: "987654", phoneNumberId: "111222", accessToken: "token", signal: signal() }), { kind: "forbidden" });
  assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => { throw new DOMException("Aborted", "AbortError"); }).verifyAssets({ whatsappBusinessAccountId: "987654", phoneNumberId: "111222", accessToken: "token", signal: signal() }), { kind: "timeout" });
});


test("EPIC-042 WABA subscription primitives use fixed bounded endpoints and identify only the configured Atlas app", async () => {
  const seen: Array<{ url: string; method: string | undefined; authorization: string | null }> = [], bodies: unknown[] = [
    { data: [{ whatsapp_business_api_data: { id: "999" } }, { whatsapp_business_api_data: { id: "123456" } }] },
    { data: [{ whatsapp_business_api_data: { id: "999" } }] }, { data: [] }, { success: true }, { success: true },
  ];
  const provider = new MetaEmbeddedSignupGraphProvider(configuration, async (url, init) => { const headers = new Headers(init?.headers); seen.push({ url: String(url), method: init?.method, authorization: headers.get("authorization") }); return json(bodies.shift()); });
  assert.deepEqual(await provider.inspectWabaSubscription({ wabaId: "123", accessToken: "token", signal: signal() }), { kind: "success", subscribed: true });
  assert.deepEqual(await provider.inspectWabaSubscription({ wabaId: "123", accessToken: "token", signal: signal() }), { kind: "success", subscribed: false });
  assert.deepEqual(await provider.inspectWabaSubscription({ wabaId: "123", accessToken: "token", signal: signal() }), { kind: "success", subscribed: false });
  assert.deepEqual(await provider.subscribeWaba({ wabaId: "123", accessToken: "token", signal: signal() }), { kind: "success" });
  assert.deepEqual(await provider.unsubscribeWaba({ wabaId: "123", accessToken: "token", signal: signal() }), { kind: "success" });
  assert.equal(seen.every(value => value.url === "https://graph.facebook.com/v25.0/123/subscribed_apps"), true);
  assert.deepEqual(seen.map(value => value.method), ["GET", "GET", "GET", "POST", "DELETE"]);
  assert.equal(seen.every(value => value.authorization === "Bearer token"), true);
  assert.doesNotMatch(JSON.stringify(await provider.inspectWabaSubscription({ wabaId: "bad", accessToken: "token", signal: signal() })), /token/);
  for (const body of [{}, { data: "bad" }, { data: Array.from({ length: 101 }, () => ({})) }]) assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => json(body)).inspectWabaSubscription({ wabaId: "123", accessToken: "token", signal: signal() }), { kind: "invalid_response" });
  for (const body of [{ success: false }, {}]) assert.deepEqual(await new MetaEmbeddedSignupGraphProvider(configuration, async () => json(body)).subscribeWaba({ wabaId: "123", accessToken: "token", signal: signal() }), { kind: "invalid_response" });
  for (const [status, kind] of [[401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [429, "rate_limited"], [500, "unavailable"]] as const) assert.equal((await new MetaEmbeddedSignupGraphProvider(configuration, async () => json({}, status)).subscribeWaba({ wabaId: "123", accessToken: "token", signal: signal() })).kind, kind);
  assert.equal((await new MetaEmbeddedSignupGraphProvider(configuration, async () => { throw new DOMException("Aborted", "AbortError"); }).subscribeWaba({ wabaId: "123", accessToken: "token", signal: signal() })).kind, "timeout");
});
