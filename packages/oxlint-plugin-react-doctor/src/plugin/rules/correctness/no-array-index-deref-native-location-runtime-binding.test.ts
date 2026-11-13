import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

const cases = [
  {
    name: "native-query-fallback-baseline",
    code: 'export const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    expected: 0,
  },
  {
    name: "global-erased-window-interface",
    code: 'interface window {}\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    expected: 0,
  },
  {
    name: "global-erased-window-type-alias",
    code: 'type window = unknown;\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    expected: 0,
  },
  {
    name: "nested-erased-window-interface",
    code: 'export const readSection = () => { interface window {} return (window.location.search || "?").split("?")[1].trim(); };\n',
    expected: 0,
  },
  {
    name: "genuine-local-window-control",
    code: 'const window = {location: {search: "missing"}};\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    expected: 1,
  },
  {
    name: "genuine-local-window-with-interface",
    code: 'const window = {location: {search: "missing"}};\ninterface window {}\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    expected: 1,
  },
  {
    name: "native-empty-fallback-positive",
    code: 'export const readSection = () => (window.location.search || "").split("?")[1].split("&");\n',
    expected: 1,
  },
  {
    name: "native-uncovered-query-positive",
    code: 'export const readSection = () => window.location.search.split("?")[1].split("&");\n',
    expected: 1,
  },
  {
    name: "readonly-local-marker",
    code: 'const marker=1; export const readSection=()=>{void marker;return (window.location.search||"?").split("?")[1].trim();};',
    expected: 0,
  },
  {
    name: "merged-readonly-local-marker",
    code: 'const marker=1; interface marker{} export const readSection=()=>{void marker;return (window.location.search||"?").split("?")[1].trim();};',
    expected: 0,
  },
  {
    name: "inner-interface-outer-marker",
    code: 'const marker=1; export const readSection=()=>{interface marker{} void marker;return (window.location.search||"?").split("?")[1].trim();};',
    expected: 0,
  },
  {
    name: "erased-global-window-write-still-declines",
    code: 'interface window{}; window.location.search="plain"; export const readSection=()=> (window.location.search||"?").split("?")[1].trim();',
    expected: 1,
  },
  {
    name: "erased-global-window-escape-still-declines",
    code: 'import { observeHost } from "./observer"; interface window{}; observeHost(window); export const readSection=()=> (window.location.search||"?").split("?")[1].trim();',
    expected: 1,
  },
];

describe("native location fallback runtime binding identity", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, code, {
      filename: "/synthetic/native-location-runtime-binding.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: [] } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
