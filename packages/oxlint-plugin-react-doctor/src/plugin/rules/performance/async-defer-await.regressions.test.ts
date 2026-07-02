import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { asyncDeferAwait } from "./async-defer-await.js";

describe("performance/async-defer-await — regressions", () => {
  it("stays silent on an await followed by a cancelledRef.current guard", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      const cancelledRef = { current: false };
      const renderChart = async (mermaidCode) => {
        try {
          const mermaid = (await import('mermaid')).default;
          if (cancelledRef.current) {
            return;
          }
          mermaid.initialize({ startOnLoad: false });
        } catch {}
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an unrelated boolean guard after an await", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const fetchRows: () => Promise<string[]>;
      declare const shouldSkip: boolean;
      export const load = async () => {
        const rows = await fetchRows();
        if (shouldSkip) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guard on a plain variable named `current` — not a ref read", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const fetchRows: (page: number) => Promise<string[]>;
      export const loadPage = async (current: number, max: number) => {
        const rows = await fetchRows(current);
        if (current > max) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare *Ref-handle nullability guard without a .current read", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const findRow: (id: string) => Promise<{ index: number }>;
      export const scrollToRow = async (tableRef: { current: { scrollTo: (n: number) => void } } | null, id: string) => {
        const row = await findRow(id);
        if (!tableRef) return;
        tableRef.current.scrollTo(row.index);
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on an aliveRef.current staleness guard", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const serverSDK: () => Promise<void>;
      declare const aliveRef: { current: boolean };
      export const connect = async () => {
        await serverSDK();
        if (!aliveRef.current) return;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent on a known cancellation-flag guard", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const wait: () => Promise<void>;
      declare let cancelled: boolean;
      export const poll = async () => {
        await wait();
        if (cancelled) return;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
