import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsIndexMaps } from "./js-index-maps.js";

const expectFail = (code: string): void => {
  const result = runRule(jsIndexMaps, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsIndexMaps, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-index-maps — regressions", () => {
  it("flags a single-field equality `.find()` inside a loop", () => {
    expectFail(
      `function g(ids, users){ const out=[]; for(const id of ids){ out.push(users.find((u)=> u.id === id)); } return out; }`,
    );
  });

  it("does not flag a range / multi-condition `.find()` predicate", () => {
    expectPass(
      `function g(scores,bands){ const out=[]; for(const sc of scores){ const b=bands.find((b)=> sc>=b.min && sc<=b.max); out.push(b);} return out; }`,
    );
  });

  it("flags a loop-invariant receiver `.find()` inside a loop", () => {
    expectFail(
      `function f(rows, users){ for (const row of rows){ const u = users.find((u)=> u.id === row.userId); use(u); } }`,
    );
  });

  it("does not flag when the `.find()` receiver varies per loop iteration", () => {
    expectPass(
      `function f(rows, targetId){ for (const row of rows){ const cell = row.cells.find((c)=> c.id === targetId); use(cell); } }`,
    );
  });

  // Bugbot: a binding declared inside a nested callback in the loop body must
  // not shadow-mark a loop-invariant receiver of the same name as loop-variant.
  // `users` is loop-invariant here; the nested forEach's local `users` binding
  // must not suppress the finding.
  it("still flags a loop-invariant receiver when a nested callback rebinds the same name", () => {
    expectFail(
      `function f(rows, users){ for (const row of rows){ row.tags.forEach((t)=>{ const users = t.x; void users; }); const u = users.find((u)=> u.id === row.userId); use(u); } }`,
    );
  });

  // RDE (linkwarden, chartdb): a TS cast on the receiver must not hide a
  // loop-VARIANT root from `isLoopVariantReceiver` — `(links as any[]).find`
  // where `links` is the for-of binding is a different array each pass, so a
  // single pre-loop Map can't replace it.
  it("does not flag a `.find()` on a cast of the loop variable", () => {
    expectPass(
      `function f(groups, targetId){ for (const links of groups){ const m = (links as any[]).find((i)=> i.id === targetId); use(m); } }`,
    );
  });

  it("still flags a loop-invariant receiver even when it is cast", () => {
    expectFail(
      `function f(rows, users){ for (const row of rows){ const u = (users as U[]).find((u)=> u.id === row.userId); use(u); } }`,
    );
  });

  it("does not flag a receiver indexed by the loop counter (`groups[i].links.find`)", () => {
    expectPass(
      `function f(groups, targetId){ for (let i = 0; i < groups.length; i++){ const m = groups[i].links.find((l)=> l.id === targetId); use(m); } }`,
    );
  });

  it("does not flag a call-expression receiver (`getLinks(row).find`)", () => {
    expectPass(
      `function f(rows, targetId){ for (const row of rows){ const m = getLinks(row).find((l)=> l.id === targetId); use(m); } }`,
    );
  });

  it("still flags a receiver indexed by a loop-invariant constant", () => {
    expectFail(
      `function f(rows, groups){ for (const row of rows){ const m = groups[0].links.find((l)=> l.id === row.linkId); use(m); } }`,
    );
  });

  // Docs-validation r2 (cloudscape drilldown, freecut transcription):
  // the `.find()` target is push()ed / sort()ed inside the same loop, so
  // the searched array changes per iteration — the doc's explicit FP
  // ("a pre-built index can't be reused").
  it("does not flag a receiver that is push()ed inside the same loop", () => {
    expectPass(
      `function f(series){ const acc = []; for (const s of series){ let d = acc.find((i)=> i.x === s.x); if (d) { d.y += s.y; } else { acc.push({ x: s.x, y: s.y }); } } return acc; }`,
    );
  });

  it("does not flag a receiver that is sort()ed inside the same loop", () => {
    expectPass(
      `function f(clips, tracks){ for (const clip of clips){ const t = tracks.find((tr)=> tr.id === clip.trackId); if (!t) { tracks.push(make(clip)); tracks.sort((a,b)=> a.order - b.order); } } }`,
    );
  });

  it("still flags when a different array is mutated inside the loop", () => {
    expectFail(
      `function f(rows, users){ const out = []; for (const row of rows){ const u = users.find((x)=> x.id === row.userId); out.push(u); } return out; }`,
    );
  });

  // Docs-validation r2 (tracecat case-durations-table):
  // `CASE_EVENT_FILTER_OPTIONS[type].options.find(...)` — a receiver
  // rooted at a SCREAMING_SNAKE constant is an enum-sized config table,
  // the doc's tiny-N carve-out.
  it("does not flag a receiver rooted at a SCREAMING_SNAKE module constant", () => {
    expectPass(
      `function f(values, type){ const labels = []; for (const value of values){ const opt = CASE_EVENT_FILTER_OPTIONS[type].options.find((o)=> o.value === value); labels.push(opt?.label ?? value); } return labels; }`,
    );
  });

  it("still flags a lowercase-named receiver of the same shape", () => {
    expectFail(
      `function f(values, options){ const labels = []; for (const value of values){ const opt = options.find((o)=> o.value === value); labels.push(opt?.label ?? value); } return labels; }`,
    );
  });
});
