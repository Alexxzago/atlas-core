// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Container, Input, Radio, Select, Skeleton, Spinner, Surface, Textarea } from "./primitives";

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

test("uses the canonical desktop control and textarea variant contracts", () => {
  render(<><Button>Save</Button><Input aria-label="Name" /><Select aria-label="Plan"><option>Starter plan</option></Select><Textarea aria-label="Compact notes" size="compact" /><Textarea aria-label="Standard notes" /><Textarea aria-label="Long notes" size="long" /></>);
  expect(screen.getByRole("button", { name: "Save" }).className).toContain("ds-button--md");
  expect(screen.getByRole("textbox", { name: "Name" }).className).toContain("ds-control");
  expect(screen.getByRole("combobox", { name: "Plan" }).className).toContain("ds-select");
  expect(screen.getByRole("textbox", { name: "Compact notes" }).className).toContain("ds-textarea--compact");
  expect(screen.getByRole("textbox", { name: "Standard notes" }).className).toContain("ds-textarea--standard");
  expect(screen.getByRole("textbox", { name: "Long notes" }).className).toContain("ds-textarea--long");
});

test("preserves native radio semantics with the shared visual class", () => {
  render(<label className="ds-radio-label"><Radio name="delivery" value="voice" />Voice response</label>);
  const radio = screen.getByRole("radio", { name: "Voice response" });
  expect(radio.getAttribute("type")).toBe("radio");
  expect(radio.className).toContain("ds-radio");
});

test("preserves invalid and disabled native control semantics", () => {
  render(<><Input aria-label="Invalid" aria-invalid="true" /><Select aria-label="Disabled" disabled><option>Unavailable</option></Select><Button disabled>Save</Button></>);
  expect(screen.getByRole("textbox", { name: "Invalid" }).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("combobox", { name: "Disabled" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
});

test("keeps layout primitives domain-neutral and configurable", () => {
  render(<Container size="narrow"><Surface tone="raised" padding="compact">Content</Surface></Container>);
  expect(screen.getByText("Content").parentElement?.className).toContain("ds-container--narrow");
  expect(screen.getByText("Content").className).toContain("ds-surface--raised");
  expect(screen.getByText("Content").className).toContain("ds-surface--compact");
});

test("ConfirmDialog traps focus, handles Escape, returns focus, and ignores its backdrop by default", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const { rerender } = render(<><button type="button">Open confirmation</button><ConfirmDialog cancelLabel="Keep" confirmLabel="Delete" description="This cannot be undone." open={false} title="Delete workspace" onCancel={onCancel} onConfirm={onConfirm}/></>);
  const opener = screen.getByRole("button", { name: "Open confirmation" });
  opener.focus();
  rerender(<><button type="button">Open confirmation</button><ConfirmDialog cancelLabel="Keep" confirmLabel="Delete" description="This cannot be undone." open title="Delete workspace" onCancel={onCancel} onConfirm={onConfirm}/></>);
  const dialog = screen.getByRole("alertdialog", { name: "Delete workspace" });
  const cancel = screen.getByRole("button", { name: "Keep" });
  const confirm = screen.getByRole("button", { name: "Delete" });
  await waitFor(() => expect(document.activeElement).toBe(cancel));
  confirm.focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(confirm);
  fireEvent.mouseDown(dialog.parentElement!);
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
  rerender(<><button type="button">Open confirmation</button><ConfirmDialog cancelLabel="Keep" confirmLabel="Delete" description="This cannot be undone." open={false} title="Delete workspace" onCancel={onCancel} onConfirm={onConfirm}/></>);
  expect(document.activeElement).toBe(opener);
});

test("ConfirmDialog can explicitly allow backdrop cancellation", () => {
  const onCancel = vi.fn();
  render(<ConfirmDialog cancelLabel="Keep" closeOnBackdropClick confirmLabel="Delete" open title="Delete workspace" onCancel={onCancel} onConfirm={() => undefined}/>);
  const dialog = screen.getByRole("alertdialog");
  fireEvent.mouseDown(dialog.parentElement!);
  expect(onCancel).toHaveBeenCalledTimes(1);
});
