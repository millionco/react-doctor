import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryNoQueryInEffect } from "./query-no-query-in-effect.js";

describe("tanstack-query/query-no-query-in-effect — regressions", () => {
  it("stays silent when refetch() runs inside an event handler registered in the effect", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query"; function Dashboard() { const { data, refetch } = useQuery({ queryKey: ['x'], queryFn: load, refetchOnWindowFocus: false }); useEffect(() => { const onFocus = () => refetch(); window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus); }, [refetch]); return null; }`,
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
      `import { useQuery } from "@tanstack/react-query"; function Dashboard() { const { refetch } = useQuery({ queryKey: ["item"] }); useEffect(() => { const id = setInterval(() => refetch(), 30000); return () => clearInterval(id); }, [refetch]); return null; }`,
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

  it("flags renamed hook imports and destructured refetch renames", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery as useItemsQuery } from "@tanstack/react-query";
function Search() {
  const { refetch: reloadItems } = useItemsQuery({ queryKey: ["items"] });
  useEffect(() => { reloadItems(); }, [reloadItems]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags namespace hooks and static-computed refetch members", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import * as ReactQuery from "@tanstack/react-query";
function Search() {
  const query = ReactQuery["useQuery"]({ queryKey: ["items"] });
  useEffect(() => { query["refetch"](); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags exact hook, namespace, and query-result const aliases", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import * as ReactQuery from "@tanstack/react-query";
const QueryNamespace = ReactQuery;
const useItemsQuery = QueryNamespace.useQuery;
function Search() {
  const originalQuery = useItemsQuery({ queryKey: ["items"] });
  const exactQuery = originalQuery;
  const finalQuery = exactQuery;
  useEffect(() => { finalQuery.refetch(); }, [finalQuery]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags query results through TypeScript wrappers and parentheses", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search() {
  const query = ((useQuery({ queryKey: ["items"] })) as ReturnType<typeof useQuery>);
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a reassignable query-result receiver", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ fallback }) {
  let query = useQuery({ queryKey: ["items"] });
  query = fallback;
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a local hook shadows a TanStack import", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ useQuery }) {
  const query = useQuery();
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on imported and local unrelated refetch functions", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { refetch as importedRefetch } from "./search-index";
const localRefetch = () => {};
function Search() {
  useEffect(() => { importedRefetch(); localRefetch(); }, []);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on imported unrelated refetch receivers", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { searchIndex } from "./search-index";
function Search() {
  useEffect(() => { searchIndex.refetch(); }, []);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on dynamic computed members", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ methodName }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query[methodName](); }, [query, methodName]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a proven refetch in a local function invoked by the effect", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search() {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { const reload = () => query.refetch(); reload(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent after a destructured refetch binding is reassigned", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  let { refetch } = useQuery({ queryKey: ["items"] });
  refetch = customRefetch;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent after a query result refetch property is overwritten", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  query.refetch = customRefetch;
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent after an exact query alias overwrites refetch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const exactQuery = query;
  exactQuery["refetch"] = customRefetch;
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags an exact alias of a proven query refetch method", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search() {
  const query = useQuery({ queryKey: ["items"] });
  const reload = query.refetch;
  useEffect(() => { reload(); }, [reload]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags multi-hop aliases of a destructured query refetch method", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search() {
  const { refetch } = useQuery({ queryKey: ["items"] });
  const reload = refetch;
  const executeReload = reload;
  useEffect(() => { executeReload(); }, [executeReload]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent after a query method alias is reassigned", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  let reload = query.refetch;
  reload = customRefetch;
  useEffect(() => { reload(); }, [reload]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent on an unimported global useQuery", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `function Search() {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
