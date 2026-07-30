// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Alert, Badge, Button, Checkbox, Container, Input, Skeleton, Spinner, Surface, Textarea } from "./primitives";

afterEach(cleanup);

test("renders accessible native controls and semantic feedback primitives", () => {
  render(<><Button>Save</Button><Input aria-label="Company name" /><Textarea aria-label="Description" /><Checkbox aria-label="Enabled" /><Alert tone="danger">Problem</Alert><Spinner label="Saving" /><Skeleton label="Loading companies" /><Badge tone="success">Ready</Badge></>);
  expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe("button");
  expect(screen.getByRole("textbox", { name: "Company name" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Enabled" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("Problem");
  expect(screen.getByRole("status", { name: "Saving" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Loading companies" })).toBeTruthy();
  expect(screen.getByText("Ready").className).toContain("ds-badge--success");
});

test("keeps layout primitives domain-neutral and configurable", () => {
  render(<Container size="narrow"><Surface tone="raised" padding="7">Content</Surface></Container>);
  expect(screen.getByText("Content").parentElement?.className).toContain("ds-container--narrow");
  expect(screen.getByText("Content").className).toContain("ds-surface--raised");
});
