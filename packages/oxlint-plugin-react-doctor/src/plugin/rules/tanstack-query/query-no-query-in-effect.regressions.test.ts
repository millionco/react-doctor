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

  it.each([
    {
      name: "a TypeScript-wrapped named hook",
      importStatement: 'import { useQuery } from "@tanstack/react-query";',
      hookCall: "(useQuery as typeof useQuery)({ queryKey: ['items'] })",
    },
    {
      name: "a parenthesized namespace hook",
      importStatement: 'import * as ReactQuery from "@tanstack/react-query";',
      hookCall: "(ReactQuery.useQuery)({ queryKey: ['items'] })",
    },
    {
      name: "a TypeScript-wrapped namespace hook",
      importStatement: 'import * as ReactQuery from "@tanstack/react-query";',
      hookCall: "(ReactQuery.useQuery as typeof ReactQuery.useQuery)({ queryKey: ['items'] })",
    },
    {
      name: "a hook on a TypeScript-wrapped namespace",
      importStatement: 'import * as ReactQuery from "@tanstack/react-query";',
      hookCall: "(ReactQuery as typeof ReactQuery).useQuery({ queryKey: ['items'] })",
    },
    {
      name: "a no-substitution template-computed namespace hook",
      importStatement: 'import * as ReactQuery from "@tanstack/react-query";',
      hookCall: "ReactQuery[`useQuery`]({ queryKey: ['items'] })",
    },
  ])("flags refetch from $name", ({ importStatement, hookCall }) => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `${importStatement}
function Search() {
  const query = ${hookCall};
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    {
      name: "a dynamic template-computed namespace member",
      declaration: 'const hookName = "useQuery";',
      hookCall: "ReactQuery[`${hookName}`]({ queryKey: ['items'] })",
    },
    {
      name: "a shadowed namespace",
      declaration: "",
      hookCall: "(ReactQuery as QueryLibrary).useQuery({ queryKey: ['items'] })",
      parameter: ", ReactQuery",
    },
    {
      name: "a userland wrapper around the hook",
      declaration: "const useItemsQuery = (options) => ReactQuery.useQuery(options);",
      hookCall: "useItemsQuery({ queryKey: ['items'] })",
    },
  ])("stays silent on $name", ({ declaration, hookCall, parameter = "" }) => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import * as ReactQuery from "@tanstack/react-query";
${declaration}
function Search({ QueryLibrary }${parameter}) {
  const query = ${hookCall};
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
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

  it("stays silent when render overwrites a live refetch member after effect registration", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query.refetch(); }, [query]);
  query.refetch = customRefetch;
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when render synchronously invokes an overwrite helper after registration", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  useEffect(() => { query.refetch(); }, [query]);
  overwriteRefetch();
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags refetch when render only conditionally invokes the overwrite helper", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, shouldOverwrite }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  useEffect(() => { query.refetch(); }, [query]);
  if (shouldOverwrite) overwriteRefetch();
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    ["ternary branch", "shouldOverwrite ? (query.refetch = customRefetch) : undefined"],
    ["logical AND right side", "shouldOverwrite && (query.refetch = customRefetch)"],
    ["logical OR right side", "shouldOverwrite || (query.refetch = customRefetch)"],
    ["nullish right side", "value ?? (query.refetch = customRefetch)"],
    ["logical AND assignment", "query.refetch &&= customRefetch"],
    ["logical OR assignment", "query.refetch ||= customRefetch"],
    ["nullish assignment", "query.refetch ??= customRefetch"],
    [
      "nested Object.assign right side",
      "shouldOverwrite && Object.assign(query, { refetch: customRefetch })",
    ],
    [
      "nested Object.defineProperty right side",
      'shouldOverwrite && Object.defineProperty(query, "refetch", { value: customRefetch })',
    ],
  ])("flags refetch when render overwrites only in a %s", (_name, overwriteExpression) => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, shouldOverwrite, value }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query.refetch(); }, [query]);
  ${overwriteExpression};
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    ["ternary branch", "shouldOverwrite ? overwriteRefetch() : undefined"],
    ["logical AND right side", "shouldOverwrite && overwriteRefetch()"],
    ["logical OR right side", "shouldOverwrite || overwriteRefetch()"],
    ["nullish right side", "value ?? overwriteRefetch()"],
  ])("flags refetch when render invokes its overwrite helper through a %s", (_name, call) => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, shouldOverwrite, value }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  useEffect(() => { query.refetch(); }, [query]);
  ${call};
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    ["ternary test", "(query.refetch = customRefetch) ? renderSearch() : renderEmpty()"],
    ["logical left side", "(query.refetch = customRefetch) && renderSearch()"],
    ["helper on a logical left side", "overwriteRefetch() && renderSearch()"],
    [
      "Object.assign on a logical left side",
      "Object.assign(query, { refetch: customRefetch }) && renderSearch()",
    ],
    [
      "Object.defineProperty on a logical left side",
      'Object.defineProperty(query, "refetch", { value: customRefetch }) && renderSearch()',
    ],
  ])("stays silent when render guarantees an overwrite in a %s", (_name, overwriteExpression) => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; return true; };
  useEffect(() => { query.refetch(); }, [query]);
  ${overwriteExpression};
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags refetch when a render helper overwrites only after awaiting", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = async () => { await pause(); query.refetch = customRefetch; };
  useEffect(() => { query.refetch(); }, [query]);
  overwriteRefetch();
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a render helper overwrites before awaiting", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = async () => { query.refetch = customRefetch; await pause(); };
  useEffect(() => { query.refetch(); }, [query]);
  overwriteRefetch();
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags refetch when a render loop may never overwrite the member", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, items }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query.refetch(); }, [query]);
  for (const item of items) query.refetch = customRefetch;
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a captured refetch when render overwrites its former receiver afterward", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const reload = query.refetch;
  useEffect(() => { reload(); }, [reload]);
  query.refetch = customRefetch;
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when the render overwrite only occurs in catch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  try { renderSearch(); } catch { query.refetch = customRefetch; }
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when a render try path can bypass the overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, shouldOverwrite }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query.refetch(); }, [query]);
  try { if (shouldOverwrite) query.refetch = customRefetch; } finally { renderSearch(); }
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a render finally block always overwrites before the effect", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query.refetch(); }, [query]);
  try { renderSearch(); } catch {} finally { query.refetch = customRefetch; }
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when an explicit throw makes the catch overwrite unavoidable", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query.refetch(); }, [query]);
  try { throw new Error("replace"); } catch { query.refetch = customRefetch; }
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a direct refetch when an earlier deferred handler contains an overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const onClick = () => { query.refetch = customRefetch; };
  useEffect(() => { query.refetch(); }, [query]);
  return <button onClick={onClick}>Reload</button>;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a direct refetch when an earlier uncalled helper contains an overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when an effect invokes the overwrite helper before refetch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  useEffect(() => { overwriteRefetch(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a nested effect read before its callback overwrites refetch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    const reload = () => { query.refetch(); };
    reload();
    query.refetch = customRefetch;
  }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a nested effect read after its callback overwrites refetch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    const reload = () => { query.refetch(); };
    query.refetch = customRefetch;
    reload();
  }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a hoisted nested effect read invoked before its callback overwrites refetch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    reload();
    query.refetch = customRefetch;
    function reload() { query.refetch(); }
  }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when an awaited nested read resumes after the effect overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    reload();
    query.refetch = customRefetch;
    async function reload() { await pause(); query.refetch(); }
  }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a nested read that executes synchronously before the effect overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    reload();
    query.refetch = customRefetch;
    async function reload() { query.refetch(); await pause(); }
  }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when an async wrapper reaches a nested read after an effect overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    const reload = () => { query.refetch(); };
    const reloadLater = async () => { await pause(); reload(); };
    query.refetch = customRefetch;
    reloadLater();
  }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a nested read when an async wrapper only conditionally reaches it", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, shouldReload }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    const reload = () => { query.refetch(); };
    const reloadLater = async () => { await pause(); if (shouldReload) reload(); };
    query.refetch = customRefetch;
    reloadLater();
  }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when an invoked wrapper synchronously calls the overwrite helper", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  const wrapper = () => { overwriteRefetch(); };
  useEffect(() => { wrapper(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent through aliased two-hop overwrite helpers", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  const exactOverwrite = overwriteRefetch;
  const wrapper = () => { exactOverwrite(); };
  const exactWrapper = wrapper;
  useEffect(() => { exactWrapper(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags refetch when a two-hop overwrite wrapper is invoked afterward", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  const wrapper = () => { overwriteRefetch(); };
  useEffect(() => { query.refetch(); wrapper(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when an effect invokes the overwrite helper afterward", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  useEffect(() => { query.refetch(); overwriteRefetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when an invoked async helper overwrites only after awaiting", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = async () => { await pause(); query.refetch = customRefetch; };
  useEffect(() => { overwriteRefetch(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when an invoked helper contains a statically unreachable overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { if (false) query.refetch = customRefetch; };
  useEffect(() => { overwriteRefetch(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when an invoked helper only conditionally overwrites", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, shouldOverwrite }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { if (shouldOverwrite) query.refetch = customRefetch; };
  useEffect(() => { overwriteRefetch(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when a wrapper only conditionally invokes the overwrite helper", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, shouldOverwrite }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; };
  const wrapper = () => { if (shouldOverwrite) overwriteRefetch(); };
  useEffect(() => { wrapper(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when an invoked helper returns before its overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { return; query.refetch = customRefetch; };
  useEffect(() => { overwriteRefetch(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when an invoked helper throws before its overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { throw new Error("stop"); query.refetch = customRefetch; };
  useEffect(() => { overwriteRefetch(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a reachable overwrite precedes an early return", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = () => { query.refetch = customRefetch; return; };
  useEffect(() => { overwriteRefetch(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent after Object.assign overwrites refetch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  Object.assign(query, { refetch: customRefetch });
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent after Object.defineProperty overwrites refetch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  Object.defineProperty(query, \`refetch\`, { value: customRefetch });
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags refetch before a later Object.assign overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => { query.refetch(); Object.assign(query, { refetch: customRefetch }); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch after a no-op self assignment", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search() {
  const query = useQuery({ queryKey: ["items"] });
  query.refetch = query.refetch;
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when Object.assign restores the original method last", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  Object.assign(query, { refetch: customRefetch }, { refetch: query.refetch });
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when defineProperty preserves the original method", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search() {
  const query = useQuery({ queryKey: ["items"] });
  Object.defineProperty(query, "refetch", { value: query.refetch });
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags refetch when a local Object shadows the global mutation API", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch, Object }) {
  const query = useQuery({ queryKey: ["items"] });
  Object.assign(query, { refetch: customRefetch });
  useEffect(() => { query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when an invoked async helper overwrites before awaiting", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const overwriteRefetch = async () => { query.refetch = customRefetch; await pause(); };
  const exactOverwrite = overwriteRefetch;
  useEffect(() => { exactOverwrite(); query.refetch(); }, [query]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags an earlier direct refetch when cleanup contains an overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  useEffect(() => {
    query.refetch();
    return () => { query.refetch = customRefetch; };
  }, [query]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
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

  it("stays silent when refetch is overwritten before destructuring", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  query.refetch = customRefetch;
  const { refetch } = query;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when an exact alias overwrites refetch before destructuring", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const exactQuery = query;
  exactQuery.refetch = customRefetch;
  const { refetch } = query;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a refetch captured before the query property is overwritten", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const { refetch } = query;
  query.refetch = customRefetch;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a refetch captured before an exact alias overwrites the property", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const exactQuery = query;
  const { refetch } = query;
  exactQuery["refetch"] = customRefetch;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a template-computed refetch is overwritten before capture", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  query[\`refetch\`] = customRefetch;
  const { refetch } = query;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when an exact alias template-overwrites refetch before capture", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const exactQuery = query;
  exactQuery[\`refetch\`] = customRefetch;
  const { refetch } = query;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("flags a refetch captured before a template-computed overwrite", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const { refetch } = query;
  query[\`refetch\`] = customRefetch;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags capture before an exact alias template-overwrites refetch", () => {
    const { diagnostics } = runRule(
      queryNoQueryInEffect,
      `import { useQuery } from "@tanstack/react-query";
function Search({ customRefetch }) {
  const query = useQuery({ queryKey: ["items"] });
  const exactQuery = query;
  const { refetch } = query;
  exactQuery[\`refetch\`] = customRefetch;
  useEffect(() => { refetch(); }, [refetch]);
  return null;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
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
