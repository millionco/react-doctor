import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderDeferReadsHook } from "./rerender-defer-reads-hook.js";

const runDeferReadsRule = (componentBody: string) =>
  runRule(
    rerenderDeferReadsHook,
    `function SearchButton() {
${componentBody}
}`,
  );

describe("state-and-effects/rerender-defer-reads-hook — exact aliases", () => {
  it("flags a directly bound hook result read only inside an event handler", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  const onClick = () => searchParams.get("query");
  return <button onClick={onClick}>Search</button>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a hook result through multiple exact const aliases", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  const currentParams = searchParams;
  const handlerParams = currentParams;
  const onClick = () => handlerParams.get("query");
  return <button onClick={onClick}>Search</button>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a hook result extracted through an exact singleton array", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  const [handlerParams] = [searchParams];
  const onClick = () => handlerParams.get("query");
  return <button onClick={onClick}>Search</button>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a singleton-array alias through a TypeScript expression wrapper", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  const [handlerParams] = [searchParams as SearchParams];
  const onClick = () => handlerParams.get("query");
  return <button onClick={onClick}>Search</button>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when an alias is read during render", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  const currentParams = searchParams;
  return <div>{currentParams.get("query")}</div>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the hook result is unused", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  return <button>Search</button>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent across a mutable alias", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  let currentParams = searchParams;
  currentParams = getFallbackParams();
  const onClick = () => currentParams.get("query");
  return <button onClick={onClick}>Search</button>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent across a conditional alias", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  const currentParams = enabled ? searchParams : getFallbackParams();
  const onClick = () => currentParams.get("query");
  return <button onClick={onClick}>Search</button>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a same-named binding inside a nested lexical scope", () => {
    const result = runDeferReadsRule(`  const searchParams = useSearchParams();
  const readFallback = (searchParams) => searchParams.get("query");
  return <button onClick={() => readFallback(getFallbackParams())}>Search</button>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
