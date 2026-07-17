import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFakeBrowserChrome } from "./no-fake-browser-chrome.js";

describe("no-fake-browser-chrome", () => {
  it("flags decorative traffic-light chrome inside a framed preview", () => {
    const result = runRule(
      noFakeBrowserChrome,
      `const Preview = () => <div className="overflow-hidden rounded-xl border"><div className="border-b"><div className="flex gap-2"><span className="size-3 rounded-full bg-red-500" /><span className="size-3 rounded-full bg-yellow-500" /><span className="size-3 rounded-full bg-green-500" /></div></div><img src="/preview.png" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows semantic status indicators", () => {
    const result = runRule(
      noFakeBrowserChrome,
      `const Status = () => <div className="flex gap-2"><span className="size-3 rounded-full bg-red-500">Error</span><span className="size-3 rounded-full bg-yellow-500">Warning</span><span className="size-3 rounded-full bg-green-500">Ready</span></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a framed preview shell", () => {
    const result = runRule(
      noFakeBrowserChrome,
      `const Legend = () => <div className="flex gap-2"><span className="size-3 rounded-full bg-red-500" /><span className="size-3 rounded-full bg-yellow-500" /><span className="size-3 rounded-full bg-green-500" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
