import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface LocalCleanupCase {
  name: string;
  body: string;
  expectedDiagnostics: number;
}

const cases: LocalCleanupCase[] = [
  {
    name: "stable declared release helper",
    body: "let release = () => stop(); return () => release();",
    expectedDiagnostics: 0,
  },
  {
    name: "replaced release helper",
    body: "let release = () => stop(); release = () => {}; return () => release();",
    expectedDiagnostics: 1,
  },
  {
    name: "hidden replacement release helper",
    body: "let release = () => stop(); try { throw {}; } catch ({ unused = (release = () => {}) }: any) {} return () => release();",
    expectedDiagnostics: 1,
  },
  {
    name: "unreachable effect finalizer throw",
    body: "try { return () => stop(); } finally { if (false) throw new Error(); }",
    expectedDiagnostics: 0,
  },
  {
    name: "constant finalizer selects cleanup",
    body: "try { return () => {}; } finally { if (true) return () => stop(); }",
    expectedDiagnostics: 0,
  },
  {
    name: "caught unknown prefix",
    body: "return () => { try { notify(); } catch {} stop(); };",
    expectedDiagnostics: 0,
  },
  {
    name: "local release helper",
    body: "const release = () => stop(); return () => release();",
    expectedDiagnostics: 0,
  },
  {
    name: "cleanup return through finally",
    body: "return () => { try { return; } finally { stop(); } };",
    expectedDiagnostics: 0,
  },
  {
    name: "effect finally throws",
    body: "try { return () => stop(); } finally { throw new Error(); }",
    expectedDiagnostics: 1,
  },
  {
    name: "effect finally unknown call",
    body: "try { return () => stop(); } finally { notify(); }",
    expectedDiagnostics: 1,
  },
  {
    name: "effect finally returns void",
    body: "try { return () => stop(); } finally { return; }",
    expectedDiagnostics: 1,
  },
  {
    name: "effect finally returns noop",
    body: "try { return () => stop(); } finally { return () => {}; }",
    expectedDiagnostics: 1,
  },
  {
    name: "effect finally conditionally returns noop",
    body: "try { return () => stop(); } finally { if (enabled) return () => {}; }",
    expectedDiagnostics: 1,
  },
  {
    name: "effect finally conditionally throws",
    body: "try { return () => stop(); } finally { if (enabled) throw new Error(); }",
    expectedDiagnostics: 1,
  },
  {
    name: "effect finally selects cleanup",
    body: "try { return () => {}; } finally { return () => stop(); }",
    expectedDiagnostics: 0,
  },
  {
    name: "effect finally catches unknown call",
    body: "try { return () => stop(); } finally { try { notify(); } catch {} }",
    expectedDiagnostics: 0,
  },
  {
    name: "wrapped retained acquisition",
    body: 'retain(() => (RECEIVER.addListener!)("event", () => {})); return () => stop();',
    expectedDiagnostics: 1,
  },
  {
    name: "released wrapped cleanup acquisition",
    body: 'return () => { stop(); const nextStop = (RECEIVER.addListener!)("event", () => {}); nextStop(); };',
    expectedDiagnostics: 0,
  },
  {
    name: "unknown constructor before release",
    body: "return () => { new UnknownConstructor(); stop(); };",
    expectedDiagnostics: 1,
  },
  { name: "direct release", body: "return () => stop();", expectedDiagnostics: 0 },
  {
    name: "finally release",
    body: "return () => { try { notify(); } finally { stop(); } };",
    expectedDiagnostics: 0,
  },
  {
    name: "multiple releases",
    body: 'const secondStop = RECEIVER.addListener("event", () => {}); return () => { stop(); secondStop(); };',
    expectedDiagnostics: 0,
  },
  {
    name: "released cleanup acquisition",
    body: 'return () => { stop(); const nextStop = RECEIVER.addListener("event", () => {}); nextStop(); };',
    expectedDiagnostics: 0,
  },
  {
    name: "unknown call after release",
    body: "return () => { stop(); notify(); };",
    expectedDiagnostics: 0,
  },
  {
    name: "conditional release",
    body: "return () => { if (enabled) stop(); };",
    expectedDiagnostics: 1,
  },
  {
    name: "skipped release",
    body: "return () => { if (enabled) return; stop(); };",
    expectedDiagnostics: 1,
  },
  {
    name: "throw before release",
    body: "return () => { throw new Error(); stop(); };",
    expectedDiagnostics: 1,
  },
  {
    name: "discarded cleanup acquisition",
    body: 'return () => { stop(); RECEIVER.addListener("event", () => {}); };',
    expectedDiagnostics: 1,
  },
  {
    name: "retained acquisition",
    body: 'retain(() => RECEIVER.addListener("event", () => {})); return () => stop();',
    expectedDiagnostics: 1,
  },
  {
    name: "unknown call before release",
    body: "return () => { notify(); stop(); };",
    expectedDiagnostics: 1,
  },
  {
    name: "logging before release",
    body: "return () => { console.log('cleanup'); stop(); };",
    expectedDiagnostics: 1,
  },
  {
    name: "unknown call between releases",
    body: 'const secondStop = RECEIVER.addListener("event", () => {}); return () => { stop(); notify(); secondStop(); };',
    expectedDiagnostics: 1,
  },
  {
    name: "finally releases both handles",
    body: 'const secondStop = RECEIVER.addListener("event", () => {}); return () => { try { notify(); } finally { stop(); secondStop(); } };',
    expectedDiagnostics: 0,
  },
  {
    name: "unknown effect call before cleanup return",
    body: "notify(); return () => stop();",
    expectedDiagnostics: 1,
  },
  {
    name: "effect throw before cleanup return",
    body: "throw new Error(); return () => stop();",
    expectedDiagnostics: 1,
  },
  { name: "wrong handle", body: "return () => anotherStop();", expectedDiagnostics: 1 },
  { name: "missing cleanup", body: "", expectedDiagnostics: 1 },
  {
    name: "unreleased second handle",
    body: 'RECEIVER.addListener("event", () => {}); return () => stop();',
    expectedDiagnostics: 1,
  },
];

describe.each([
  {
    name: "closed local object",
    receiver: "navigation",
    declaration:
      "const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };",
    provider: "",
  },
  {
    name: "declared navigation",
    receiver: "navigation",
    declaration: "const navigation = useNavigation();",
    provider:
      "interface Navigation { addListener: (event: string, callback: () => void) => () => void; } declare function useNavigation(): Navigation;",
  },
  {
    name: "declared renamed navigation",
    receiver: "coveredNavigation",
    declaration: "const coveredNavigation = useNavigation();",
    provider:
      "interface Navigation { addListener: (event: string, callback: () => void) => () => void; } declare function useNavigation(): Navigation;",
  },
])("local callable lifetime ($name)", ({ receiver, declaration, provider }) => {
  it.each(cases)("$name", ({ body, expectedDiagnostics }) => {
    const source = `import { useEffect } from "react";
      ${provider}
      export const Panel = () => {
        ${declaration}
        useEffect(() => {
          const stop = ${receiver}.addListener("event", () => {});
          ${body.replaceAll("RECEIVER", receiver)}
        }, [${receiver}]);
        return null;
      };`;
    const mirror = runRule(effectNeedsCleanup, source, { includeLocations: true });
    const actual = runRule(wrapWithSemanticContext(effectNeedsCleanup), source, {
      includeLocations: true,
    });
    expect(actual.parseErrors).toEqual([]);
    expect(actual).toEqual(mirror);
    expect(actual.diagnostics).toHaveLength(expectedDiagnostics);
  });

  it.each([
    { name: "stable let handle", mutation: "", expectedDiagnostics: 0 },
    { name: "replaced let handle", mutation: "stop = () => {};", expectedDiagnostics: 1 },
    {
      name: "hidden replaced let handle",
      mutation: "try { throw {}; } catch ({ unused = (stop = () => {}) }: any) {}",
      expectedDiagnostics: 1,
    },
  ])("$name", ({ mutation, expectedDiagnostics }) => {
    const source = `import { useEffect } from "react";
      ${provider}
      export const Panel = () => {
        ${declaration}
        useEffect(() => {
          let stop = ${receiver}.addListener("event", () => {});
          ${mutation}
          return () => stop();
        }, [${receiver}]);
        return null;
      };`;
    const result = runRule(wrapWithSemanticContext(effectNeedsCleanup), source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});
