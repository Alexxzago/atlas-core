// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { RouterProvider, useRouter } from "./RouterProvider";

function RouterProbe(): React.JSX.Element {
  const { route, navigate, navigateToOwnWorkspace, intentionalWorkspaceAccess } = useRouter();
  return <><p>{route.name}</p><p>{intentionalWorkspaceAccess ? "customer-mode" : "admin-mode"}</p><button onClick={() => navigate("/companies/3")}>Navigate</button><button onClick={navigateToOwnWorkspace}>Own workspace</button><button onClick={() => navigate("/onboarding/workspace", { replace: true })}>Workspace onboarding</button><button onClick={() => navigate("/admin")}>Administration</button></>;
}

afterEach(() => cleanup());

test("updates route state for deterministic popstate traversal", () => {
  window.history.replaceState({}, "", "/dashboard");
  render(<RouterProvider><RouterProbe /></RouterProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  expect(window.location.pathname).toBe("/companies/3");
  expect(screen.getByText("company-overview")).toBeTruthy();
  act(() => {
    window.history.replaceState({}, "", "/dashboard");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByText("dashboard")).toBeTruthy();
});

test("keeps intentional customer mode through workspace onboarding and clears it on administration", () => {
  window.history.replaceState({}, "", "/admin");
  render(<RouterProvider><RouterProbe /></RouterProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Own workspace" }));
  expect(window.location.pathname).toBe("/companies");
  expect(screen.getByText("customer-mode")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Workspace onboarding" }));
  expect(window.location.pathname).toBe("/onboarding/workspace");
  expect(screen.getByText("customer-mode")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Administration" }));
  expect(screen.getByText("admin-mode")).toBeTruthy();
});
