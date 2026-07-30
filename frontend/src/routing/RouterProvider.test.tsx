// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { RouterProvider, useRouter } from "./RouterProvider";

function RouterProbe(): React.JSX.Element {
  const { route, navigate } = useRouter();
  return <><p>{route.name}</p><button onClick={() => navigate("/companies/3")}>Navigate</button></>;
}

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
