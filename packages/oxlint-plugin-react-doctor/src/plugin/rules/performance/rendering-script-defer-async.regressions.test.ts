import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingScriptDeferAsync } from "./rendering-script-defer-async.js";

const expectFail = (code: string): void => {
  const result = runRule(renderingScriptDeferAsync, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(renderingScriptDeferAsync, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("performance/rendering-script-defer-async — regressions", () => {
  it("still flags a classic blocking script", () => {
    expectFail(`const D = () => <head><script src="/app.js" /></head>;`);
  });

  it("still flags an external analytics script without defer or async", () => {
    expectFail(
      `const D = () => <head><script src="https://cdn.example.com/analytics.js" /></head>;`,
    );
  });

  // FP anchor (openflipbook /theme-init.js): the script is deliberately
  // render-blocking to set the theme before first paint — deferring it
  // reintroduces the FOUC it prevents.
  it("does not flag a theme-init bootstrap script", () => {
    expectPass(`const L = () => <head><script src="/theme-init.js" /></head>;`);
  });

  // FP anchor (hyperdx /__ENV.js): runtime-env injection must execute
  // before any other script reads its globals.
  it("does not flag a runtime-env bootstrap script", () => {
    expectPass(`const D = () => <Head><script src="/__ENV.js" /></Head>;`);
  });

  // FP anchor (gatsby polyfill emission): noModule scripts never run in
  // module-supporting browsers.
  it("does not flag a noModule polyfill script", () => {
    expectPass(`const B = () => <script key="polyfill" src="/polyfill.js" noModule={true} />;`);
  });

  // FP anchor (gatsby develop/ssr entries): scripts appended to
  // postBodyComponents land at the end of <body>, after the document is
  // parsed — they don't block rendering.
  it("does not flag scripts placed via postBodyComponents", () => {
    expectPass(
      `const html = React.createElement(Html, { postBodyComponents: postBodyComponents.concat([<script key="framework" src="/framework.js" />, <script key="commons" src="/commons.js" />].filter(Boolean)) });`,
    );
  });
});
