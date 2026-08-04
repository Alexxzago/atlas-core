import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const foundations=readFileSync(new URL("./foundations.css",import.meta.url),"utf8"),layout=readFileSync(new URL("../styles/layout.css",import.meta.url),"utf8"),components=readFileSync(new URL("../styles/components.css",import.meta.url),"utf8");
test("shared semantic interaction and motion tokens are defined",()=>{for(const token of ["--atlas-motion-instant","--atlas-motion-fast","--atlas-motion-standard","--atlas-motion-slow","--atlas-ease-standard","--atlas-interactive-hover-translate","--atlas-focus-ring-color","--atlas-surface-hover","--atlas-border-selected"])assert.ok(foundations.includes(token),token)});
test("route, navigation, popover and reduced-motion behavior share the interaction system",()=>{assert.match(layout,/\.route-transition/);assert.match(layout,/\.responsibility-navigation a:hover/);assert.match(layout,/\.language-control__options/);assert.match(layout,/@media\(prefers-reduced-motion:reduce\)/)});
test("button hover states retain semantic text colors and disabled controls do not move",()=>{assert.match(components,/\.button--primary:hover:not\(:disabled\).*var\(--atlas-color-action-text\)/);assert.match(components,/\.button:disabled[^}]*transform: none/);assert.doesNotMatch(components,/hover[^}]*color:\s*(white|#fff)/i)});
