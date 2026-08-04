// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Callout, ContextPanel, EmptyExperience, IconButton, ObjectGrid, ObjectSurface, ProductHero, Section, StepList } from "./product";

afterEach(cleanup);

test("provides semantic product composition primitives", () => {
  render(<><ProductHero eyebrow="Workspace" title="Prepare Atlas" description="Give your employee a clear brief." action={<button>Start</button>}/><Section title="Channels"><ObjectGrid><ObjectSurface><h3>WhatsApp</h3></ObjectSurface></ObjectGrid></Section><ContextPanel label="Context"><p>Company</p></ContextPanel><Callout title="Atlas needs knowledge">Add a source.</Callout><StepList><li data-state="complete">Prepare</li><li>Connect</li></StepList><EmptyExperience title="No assistant yet" description="Prepare one to begin." action={<button>Create</button>}/><IconButton label="Close">x</IconButton></>);
  expect(screen.getByRole("heading", { name: "Prepare Atlas" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Channels" })).toBeTruthy();
  expect(screen.getByRole("complementary", { name: "Context" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
});
