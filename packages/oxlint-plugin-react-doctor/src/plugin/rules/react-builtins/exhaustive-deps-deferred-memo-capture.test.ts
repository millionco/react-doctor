import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hasVerifiedStockTsupMemoFactory } from "../../utils/read-verified-stock-tsup-memo-factory.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

vi.mock("../../utils/read-verified-stock-tsup-memo-factory.js", () => ({
  hasVerifiedStockTsupMemoFactory: vi.fn(),
}));

const source = `
  import { useEffect, useMemo, useRef } from "react";
  import { defer } from "./timers";
  export function Search({ onQuery }) {
    const latest = useRef(onQuery);
    useEffect(() => { latest.current = onQuery; }, [onQuery]);
    const search = useMemo(() => {
      if (!onQuery) return undefined;
      return defer((query) => { latest.current?.(query); });
    }, [!!onQuery]);
    return <input onChange={(event) => search?.(event.target.value)} />;
  }
`;

const run = (code: string, portedRuleMode: "curated" | "upstream" = "curated") =>
  runRule(exhaustiveDeps, code, { settings: { "react-doctor": { portedRuleMode } } });

beforeEach(() => {
  vi.mocked(hasVerifiedStockTsupMemoFactory).mockReset().mockReturnValue(true);
});

describe("exhaustive-deps memo presence guard for a debounced callback", () => {
  it("discards only the stale guard warning in curated mode", () => {
    const curated = run(source);
    expect(curated.parseErrors).toEqual([]);
    expect(curated.diagnostics).toHaveLength(1);
    expect(curated.diagnostics[0]?.message).toContain("complex expression");
    const verification = vi.mocked(hasVerifiedStockTsupMemoFactory).mock.calls;
    expect(verification).toHaveLength(1);
    expect(verification[0]?.[0]).toEqual({ source: "./timers", name: "defer" });
    expect(verification[0]?.[1].getSourceText?.()).toBe(source);
    expect(run(source, "upstream").diagnostics).toHaveLength(2);
  });

  it("retains the stale guard when the relative timer is unverified", () => {
    vi.mocked(hasVerifiedStockTsupMemoFactory).mockReturnValue(false);
    expect(run(source).diagnostics.map(({ message }) => message)).toContainEqual(
      expect.stringContaining("Include `onQuery`"),
    );
  });

  it.each([
    [
      "render-phase ref assignment",
      "useEffect(() => { latest.current = onQuery; }, [onQuery]);",
      "latest.current = onQuery;",
    ],
    [
      "another guard capture",
      "if (!onQuery) return undefined;",
      "if (!onQuery) return undefined; log(onQuery);",
    ],
    ["conditional commit writer", "useEffect(() =>", "if (active) useEffect(() =>"],
    ["different writer dependency", "}, [onQuery]);", "}, []);"],
    [
      "second ref writer",
      "const search = useMemo",
      "latest.current = replace; const search = useMemo",
    ],
    ["dynamic delay", "latest.current?.(query); });", "latest.current?.(query); }, customDelay);"],
    ["namespace hook", "useMemo(() =>", "React.useMemo(() =>"],
  ])("retains the stale warning for %s", (_description, from, to) => {
    const code = source.replace(from, to);
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map(({ message }) => message)).toContainEqual(
      expect.stringContaining("Include `onQuery`"),
    );
    expect(hasVerifiedStockTsupMemoFactory).not.toHaveBeenCalled();
  });
});
