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

  it("still flags navigate() in a useState lazy initializer (runs during render)", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); const [x] = useState(() => { navigate({ to: '/' }); return 0; }); return null; }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when startTransition(() => navigate()) sits inside a wired onClick handler", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); const goHome = () => { startTransition(() => navigate({ to: '/' })); }; return <button onClick={goHome}>Home</button>; }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a forEach callback sits inside a wired onClick handler", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); const openAll = () => { items.forEach((item) => navigate({ to: item.path })); }; return <button onClick={openAll}>All</button>; }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a render-invoked helper despite an unrelated same-named handler elsewhere", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `function RouteComponent() { const navigate = useNavigate(); const go = () => navigate({ to: '/x' }); go(); return null; }
       const Other = ({ go }) => <button onClick={go}>Go</button>;`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a custom hook returns the handler via implicit arrow return", () => {
    const { diagnostics } = runRule(
      tanstackStartNoNavigateInRender,
      `export const useLogout = () => () => navigate({ to: '/login' });`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
