import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackStartNoUseEffectFetch } from "./tanstack-start-no-use-effect-fetch.js";

const ROUTE = { filename: "src/routes/index.tsx" };

describe("tanstack-start/tanstack-start-no-useeffect-fetch — regressions", () => {
  it("stays silent when fetch() runs inside an event handler registered in the effect", () => {
    const { diagnostics } = runRule(
      tanstackStartNoUseEffectFetch,
      `function Route() { useEffect(() => { const refresh = () => { fetch('/api/ping'); }; window.addEventListener('online', refresh); return () => window.removeEventListener('online', refresh); }, []); return null; }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags fetch() called synchronously in the effect body", () => {
    const { diagnostics } = runRule(
      tanstackStartNoUseEffectFetch,
      `function Route() { useEffect(() => { fetch(url).then(setData); }, []); return null; }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags the declared-async-wrapper idiom invoked in the effect body", () => {
    const { diagnostics } = runRule(
      tanstackStartNoUseEffectFetch,
      `function Route() { useEffect(() => { const load = async () => { const res = await fetch('/api/data'); setData(await res.json()); }; load(); }, []); return null; }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("flags the async-IIFE idiom in the effect body", () => {
    const { diagnostics } = runRule(
      tanstackStartNoUseEffectFetch,
      `function Route() { useEffect(() => { (async () => { const res = await fetch('/api/data'); setData(await res.json()); })(); }, []); return null; }`,
      ROUTE,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when fetch() runs inside a setInterval callback", () => {
    const { diagnostics } = runRule(
      tanstackStartNoUseEffectFetch,
      `function Route() { useEffect(() => { const id = setInterval(() => { fetch('/api/poll'); }, 5000); return () => clearInterval(id); }, []); return null; }`,
      ROUTE,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent outside the routes directory", () => {
    const { diagnostics } = runRule(
      tanstackStartNoUseEffectFetch,
      `function Nav() { useEffect(() => { fetch(url).then(setData); }, []); return null; }`,
      { filename: "src/components/nav.tsx" },
    );
    expect(diagnostics).toHaveLength(0);
  });
});
