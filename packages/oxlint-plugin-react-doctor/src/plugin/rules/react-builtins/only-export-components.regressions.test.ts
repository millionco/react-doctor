import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { onlyExportComponents } from "./only-export-components.js";

// Issue #539: a missing filename must not crash the rule. When
// `context.filename` is undefined the rule has to coalesce instead of
// calling `normalizeFilename(undefined)`, which threw
// "Cannot read properties of undefined (reading 'replaceAll')".
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
  it("does not crash when the filename is unavailable (#539)", () => {
    expect(() => runRule(onlyExportComponents, AXIOS_FILE, { filename: undefined })).not.toThrow();
  });

  it("emits no diagnostics for a constant-only module when the filename is unknown", () => {
    const result = runRule(onlyExportComponents, AXIOS_FILE, { filename: undefined });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
