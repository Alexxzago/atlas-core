import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

type Rewrite = { source: string; destination: string };

test("Vercel proxies API traffic before routing every frontend path to the SPA", () => {
  const configuration = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as { rewrites: Rewrite[] };
  assert.deepEqual(configuration.rewrites[0], { source: "/api/:path*", destination: "https://atlas-backend-tuph.onrender.com/:path*" });
  assert.deepEqual(configuration.rewrites.at(-1), { source: "/(.*)", destination: "/index.html" });
  for (const path of ["/sign-in", "/register", "/forgot-password", "/reset-password", "/onboarding/workspace", "/onboarding/company", "/activation-pending", "/dashboard", "/companies/1/channels/whatsapp", "/conversations/inbox"]) {
    assert.equal(path.startsWith("/api/"), false);
  }
});
