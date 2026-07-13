import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryNoQueryInEffect } from "./query-no-query-in-effect.js";

describe("tanstack-query/query-no-query-in-effect — regressions", () => {
  it("stays silent when refetch() runs inside an event handler registered in the effect", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `function Dashboard() { const { data, refetch } = useQuery({ queryKey: ['x'], queryFn: load, refetchOnWindowFocus: false }); useEffect(() => { const onFocus = () => refetch(); window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus); }, [refetch]); return null; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags refetch() called synchronously in the effect body", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query"; function Dashboard() { const { refetch } = useQuery({ queryKey: ["item"] }); useEffect(() => { refetch(); }, [refetch]); return null; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch() inside an async IIFE in the effect body", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query"; function Dashboard() { const { refetch } = useQuery({ queryKey: ["item"] }); useEffect(() => { (async () => { await warmup(); refetch(); })(); }, [refetch]); return null; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch() inside a promise .then() rooted in the effect body", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query"; function Dashboard() { const { refetch } = useQuery({ queryKey: ["item"] }); useEffect(() => { loadConfig().then(() => refetch()); }, [refetch]); return null; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when refetch() runs inside a setInterval callback", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `function Dashboard() { useEffect(() => { const id = setInterval(() => refetch(), 30000); return () => clearInterval(id); }, [refetch]); return null; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags query.refetch() member calls in the effect body", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query"; function Todos({ userId }) { const query = useQuery({ queryKey: ["todos"], queryFn: fetchTodos }); useEffect(() => { query.refetch(); }, [userId]); return null; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on an unrelated receiver with a refetch method", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useEffect } from "react";
interface SearchIndex { refetch(): void }
function Search({ index }: { index: SearchIndex }) {
  useEffect(() => { index.refetch(); }, [index]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags a proven TanStack query result receiver", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
function Search() {
  const query = useQuery({ queryKey: ["items"], queryFn: loadItems });
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
