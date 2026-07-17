import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPillNavigationCount } from "./no-pill-navigation-count.js";

describe("no-pill-navigation-count", () => {
  it("flags a pill count inside navigation", () => {
    const result = runRule(
      noPillNavigationCount,
      `const Sidebar = () => <nav><a href="/inbox">Inbox <span className="rounded-full bg-gray-200 px-2">12</span></a></nav>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes an explicit navigation role", () => {
    const result = runRule(
      noPillNavigationCount,
      `const Sidebar = () => <div role={"navigation"}><span className="rounded-full border px-2">3</span></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an aligned plain count", () => {
    const result = runRule(
      noPillNavigationCount,
      `const Sidebar = () => <nav><a href="/inbox">Inbox <span className="ml-auto tabular-nums">12</span></a></nav>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores pills outside navigation and dynamic counts", () => {
    const result = runRule(
      noPillNavigationCount,
      `const Counts = ({ count }) => <><span className="rounded-full border px-2">12</span><nav><span className="rounded-full border px-2">{count}</span></nav></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
