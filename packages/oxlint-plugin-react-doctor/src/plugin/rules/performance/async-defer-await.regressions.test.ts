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

  it("stays silent on a bare side-effect await before a state guard", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      class FileStore {
        db: unknown = null;
        async init() { this.db = {}; }
        async getFile(id: string) {
          await this.init();
          if (!this.db) throw new Error("not ready");
          return id;
        }
      }
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent on a `controller.signal.aborted` guard after an await", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const fetchRows: () => Promise<string[]>;
      export const load = async (controller: AbortController) => {
        const rows = await fetchRows();
        if (controller.signal.aborted) return [];
        return rows.length;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent when the guard test calls a staleness helper", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const search: () => Promise<string[]>;
      declare const isCurrentState: () => boolean;
      export const run = async () => {
        const rows = await search();
        if (!isCurrentState()) return;
        render(rows.length);
      };
      declare const render: (n: number) => void;
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent on a generation-comparison staleness guard", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const fetchWaveform: () => Promise<Float32Array>;
      declare let latestRefreshId: number;
      export const refresh = async (refreshId: number) => {
        const samples = await fetchWaveform();
        if (refreshId !== latestRefreshId) return;
        draw(samples.length);
      };
      declare const draw: (n: number) => void;
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent when every branch of a compound guard checks response freshness", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const load: () => Promise<string[]>;
      declare const latestRequest: { current: number };
      declare const latestReview: { current: number };
      export const run = async () => {
        const requestId = latestRequest.current;
        const reviewVersion = latestReview.current;
        const rows = await load();
        if (requestId !== latestRequest.current || reviewVersion !== latestReview.current) {
          return [];
        }
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [
      "scalar tokens joined with AND",
      `requestId !== latestRequestId && reviewVersion !== latestReviewVersion`,
    ],
    [
      "nested ref comparisons",
      `(requestId !== latestRequest.current || reviewVersion !== latestReview.current) && scanId !== latestScan.current`,
    ],
    [
      "transparent TypeScript wrappers",
      `((requestId !== (latestRequest.current as number)) || ((reviewVersion !== latestReview.current) satisfies boolean)) as boolean`,
    ],
  ])("stays silent on compound freshness guards using %s", (_label, guardTest) => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const load: () => Promise<string[]>;
      declare let latestRequestId: number;
      declare let latestReviewVersion: number;
      declare const latestRequest: { current: number };
      declare const latestReview: { current: number };
      declare const latestScan: { current: number };
      export const run = async () => {
        const requestId = latestRequest.current;
        const reviewVersion = latestReview.current;
        const scanId = latestScan.current;
        const rows = await load();
        if (${guardTest}) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["plain invariant branch", `requestId !== latestRequest.current || enabled`],
    ["literal comparison branch", `requestId !== latestRequest.current || mode === "off"`],
    [
      "wrapped literal branch",
      `requestId !== latestRequest.current && minimumCount !== (0 as number)`,
    ],
  ])("still flags a compound guard with an unrelated %s", (_label, guardTest) => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const load: () => Promise<string[]>;
      declare const latestRequest: { current: number };
      declare const enabled: boolean;
      declare const mode: string;
      declare const minimumCount: number;
      export const run = async () => {
        const requestId = latestRequest.current;
        const rows = await load();
        if (${guardTest}) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["cancellation flag", `cancelled || enabled`],
    ["cancellation ref", `cancelledRef.current || enabled`],
    ["mutable helper", `isCurrent() && enabled`],
  ])("preserves the existing whole-guard exemption for a %s", (_label, guardTest) => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const load: () => Promise<string[]>;
      declare const enabled: boolean;
      declare const cancelled: boolean;
      declare const cancelledRef: { current: boolean };
      declare const isCurrent: () => boolean;
      export const run = async () => {
        const rows = await load();
        if (${guardTest}) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves the existing whole-guard exemption for a reassigned local", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const load: () => Promise<string[]>;
      declare const enabled: boolean;
      export const run = async () => {
        let failed = false;
        const rows = await load().catch(() => {
          failed = true;
          return [];
        });
        if (failed || enabled) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a compound invariant preflight guard", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const load: () => Promise<string[]>;
      declare const enabled: boolean;
      declare const minimumCount: number;
      export const run = async () => {
        const rows = await load();
        if (!enabled || minimumCount === 0) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags compound comparisons between invariant parameters", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const load: () => Promise<string[]>;
      export const run = async (
        enabled: boolean,
        expectedEnabled: boolean,
        mode: string,
        expectedMode: string,
      ) => {
        const rows = await load();
        if (enabled === expectedEnabled || mode === expectedMode) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the guard reads a flag reassigned around the await", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const del: (id: string) => Promise<void>;
      export const remove = async (id: string) => {
        let failed = false;
        const outcome = await del(id).catch(() => { failed = true; });
        if (failed) return;
        report(outcome);
      };
      declare const report: (v: unknown) => void;
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a guard that invokes an inline arrow shadowing the awaited name", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      interface FlowRow { id: string; unrelated: boolean; }
      declare const selectFlow: () => Promise<FlowRow>;
      declare const otherFlow: FlowRow;
      export const loadFlow = async () => {
        const flowRow = await selectFlow();
        if (((flowRow: FlowRow) => flowRow.unrelated)(otherFlow)) return [];
        return [flowRow.id];
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a literal-comparison guard on a parameter after an await", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const fetchRows: () => Promise<string[]>;
      export const load = async (mode: string) => {
        const rows = await fetchRows();
        if (mode === "off") return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a negated-parameter guard after a value-producing await", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const fetchRows: () => Promise<string[]>;
      export const load = async (options: { enabled: boolean }) => {
        const rows = await fetchRows();
        if (!options.enabled) return [];
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // bulwarkmail webmail onCancelScheduledForEdit: the awaited call cancels the
  // scheduled email — a side effect that must run on BOTH branches — and the
  // guard's consequent performs its own effect calls before returning, so
  // hoisting the guard above the await changes behavior.
  it("stays silent when the guard consequent performs side-effect calls", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const cancelScheduledEmailForEdit: (client: unknown, email: unknown) => Promise<unknown>;
      declare const setComposerMode: (mode: string) => void;
      declare const setShowComposer: (open: boolean) => void;
      declare const handleEditDraft: (draft: unknown) => Promise<void>;
      export const onCancelScheduledForEdit = async (client: unknown, selectedEmail: { isSmimeScheduled: boolean }) => {
        const restored = await cancelScheduledEmailForEdit(client, selectedEmail);
        if (selectedEmail.isSmimeScheduled) {
          setComposerMode("compose");
          setShowComposer(true);
          return;
        }
        if (restored) await handleEditDraft(restored);
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // pwa-kit one-click-contact-info: the awaited OTP send mutates the state the
  // guard re-reads, and the guard hides the continue button before returning.
  it("stays silent when the guard sets state before its early return", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const handleSendEmailOtp: (email: string) => Promise<{ isRegistered: boolean }>;
      declare const isOtpModalOpen: boolean;
      declare const setShowContinueButton: (visible: boolean) => void;
      export const submitEmail = async (email: string) => {
        const result = await handleSendEmailOtp(email);
        if (isOtpModalOpen) {
          setShowContinueButton(false);
          return;
        }
        return result.isRegistered;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a plain-return guard that ignores the awaited value", () => {
    const result = runRule(
      asyncDeferAwait,
      `
      declare const fetchRows: () => Promise<string[]>;
      declare const disabled: boolean;
      export const load = async () => {
        const rows = await fetchRows();
        if (disabled) return null;
        return rows;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
