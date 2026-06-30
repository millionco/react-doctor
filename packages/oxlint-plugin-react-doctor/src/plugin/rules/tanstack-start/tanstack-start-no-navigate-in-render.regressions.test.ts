import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartNoNavigateInRender } from "./tanstack-start-no-navigate-in-render.js";

const ROUTE = { filename: "src/routes/index.tsx" };

describe("tanstack-start/tanstack-start-no-navigate-in-render — regressions", () => {
  it("stays silent when navigate() lives in a named handler wired to onClick", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); const goHome = () => navigate({ to: '/' }); return <button onClick={goHome}>Home</button>; }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when navigate() is in a closure returned from a custom hook", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `export const useLogout = () => { const navigate = useNavigate(); return () => navigate({ to: '/login' }); };`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags navigate() called directly during render", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); navigate({ to: '/' }); return null; }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags navigate() in a synchronous-iteration callback during render", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); items.forEach((item) => navigate({ to: item.path })); return null; }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when navigate() runs in a non-memo custom hook's callback", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); useInterval(() => navigate({ to: '/refresh' }), 1000); return null; }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when navigate() runs in a .then() promise callback", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); doThing().then(() => navigate({ to: '/x' })); return null; }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
