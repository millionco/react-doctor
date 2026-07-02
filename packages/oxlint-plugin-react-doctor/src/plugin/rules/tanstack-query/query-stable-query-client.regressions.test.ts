import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryStableQueryClient } from "./query-stable-query-client.js";

describe("tanstack-query/query-stable-query-client — regressions", () => {
  it("stays silent when QueryClient is constructed inside an event handler", () => {
    const { diagnostics } = runRule(
      queryStableQueryClient,
      `function App() { const onClick = () => { const client = new QueryClient(); return client; }; return null; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when QueryClient is wrapped in a useState initializer", () => {
    const { diagnostics } = runRule(
      queryStableQueryClient,
      `function App() { const [client] = useState(() => new QueryClient()); return null; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags new QueryClient() directly in the component render body", () => {
    const { diagnostics } = runRule(
      queryStableQueryClient,
      `function App() { const client = new QueryClient(); return null; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when QueryClient is a direct useState argument", () => {
    const { diagnostics } = runRule(
      queryStableQueryClient,
      `function App() { const [client] = useState(new QueryClient()); return null; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when QueryClient is a direct useRef argument", () => {
    const { diagnostics } = runRule(
      queryStableQueryClient,
      `function App() { const clientRef = useRef(new QueryClient()); return null; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags an IIFE constructing QueryClient in the render body", () => {
    const { diagnostics } = runRule(
      queryStableQueryClient,
      `function App() { const client = (() => new QueryClient())(); return null; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
