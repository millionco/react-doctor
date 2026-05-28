import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { onlyExportComponents } from "./only-export-components.js";

// Issue #539: under ESLint 9 the host's `getFilename()` is a `this`-bound
// class method. The semantic-context wrapper forwarded a detached
// reference, so `getFilename()` returned undefined and the rule called
// `normalizeFilename(undefined)`, throwing:
//   "Cannot read properties of undefined (reading 'replaceAll')".
// The rule must coalesce a missing filename instead of crashing.
const AXIOS_FILE = `
import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})
`;

describe("react-builtins/only-export-components — regressions", () => {
  it("does not crash when the host getFilename() returns undefined (#539)", () => {
    expect(() =>
      runRule(onlyExportComponents, AXIOS_FILE, { getFilename: () => undefined }),
    ).not.toThrow();
  });

  it("emits no diagnostics for a constant-only module when the filename is unknown", () => {
    const result = runRule(onlyExportComponents, AXIOS_FILE, { getFilename: () => undefined });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
