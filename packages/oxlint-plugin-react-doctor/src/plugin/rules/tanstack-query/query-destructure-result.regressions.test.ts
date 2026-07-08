import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { queryDestructureResult } from "./query-destructure-result.js";

describe("tanstack-query/query-destructure-result — regressions", () => {
  it("stays silent when the whole query is returned from a custom hook", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; export function useUser(id) { const query = useQuery({ queryKey: ['user', id] }); return query; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when the whole query is forwarded as a JSX prop", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; function C() { const todosQuery = useQuery({ queryKey: ['todos'] }); return <Inner query={todosQuery} />; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags assigning the whole object then reading fields inline", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; function C() { const query = useQuery({ queryKey: ['user'] }); return query.data; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when the binding only appears in a dependency array", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; function C() { const query = useQuery({ queryKey: ['user'] }); useEffect(() => { console.log(query.data); }, [query]); return query.data; }`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the query is destructured from the binding later", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; function C() { const query = useQuery({ queryKey: ['user'] }); const { data } = query; return data; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a custom hook returns the query in a tuple", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query'; export function useUser(id) { const query = useQuery({ queryKey: ['user', id] }); return [query, id]; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags when console.log(query) merely mentions the binding", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function C() {
  const query = useQuery({ queryKey: ['user'] });
  console.log(query);
  return query.data;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when useDebugValue(query) merely mentions the binding", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
import { useDebugValue } from 'react';
function C() {
  const query = useQuery({ queryKey: ['user'] });
  useDebugValue(query);
  return query.data;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags when a shadowed unrelated binding is forwarded in a nested callback", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
function C() {
  const query = useQuery({ queryKey: ['user'] });
  const onClick = () => {
    const query = buildSearchQuery();
    send(query);
  };
  return <button onClick={onClick}>{query.data}</button>;
}`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a custom hook conditionally returns one of two whole queries", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
export function useUser(id, preferCache) {
  const remoteQuery = useQuery({ queryKey: ['user', id] });
  const cachedQuery = useQuery({ queryKey: ['cached-user', id] });
  return preferCache ? cachedQuery : remoteQuery;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a custom hook returns the query behind a logical fallback", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
export function useUser(id, fallback) {
  const query = useQuery({ queryKey: ['user', id] });
  return query ?? fallback;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when a custom hook returns the query behind a TS assertion", () => {
    const { diagnostics } = runRule(
      queryDestructureResult,
      `import { useQuery } from '@tanstack/react-query';
export function useUser(id) {
  const query = useQuery({ queryKey: ['user', id] });
  return query!;
}`,
    );
    expect(diagnostics).toHaveLength(0);
  });
});
