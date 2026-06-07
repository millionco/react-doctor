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

  // Issue #708: Expo Router `_layout.tsx` files should be treated as
  // entry points (same as Next.js `layout.tsx`) and skipped entirely.
  // The `Sentry.wrap(...)` default (an unrecognized HoC) plus the two
  // unexported local components are the exact "3x" diagnostics #708
  // reports; the entry-point skip must suppress all of them.
  it("skips Expo Router _layout.tsx files (#708)", () => {
    const expoLayoutFile = `
      import { lazy } from "react";
      const DeferredProviders = lazy(() => import("@/components/deferred-providers"));
      function RootLayout() {
        return <DeferredProviders />;
      }
      export default Sentry.wrap(RootLayout);
    `;
    const result = runRule(onlyExportComponents, expoLayoutFile, {
      filename: "src/app/_layout.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
