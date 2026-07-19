import { expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { windowOpenWithoutNoopener } from "./window-open-without-noopener.js";

const REPEATED_POPUP_CALL_COUNT = 2_000;
const DISTINCT_WRAPPER_COUNT = 500;
const DISTINCT_ROUTER_DESTINATION_COUNT = 1_000;
const REPEATED_BLOB_POPUP_COUNT = 2_000;

it("audits repeated dynamic popup calls without pathological rescans", () => {
  const popupCalls = Array.from(
    { length: REPEATED_POPUP_CALL_COUNT },
    () => "window.open(url);",
  ).join("\n");
  const result = runRule(windowOpenWithoutNoopener, `const openAll = (url) => { ${popupCalls} };`);
  expect(result.diagnostics).toHaveLength(REPEATED_POPUP_CALL_COUNT);
});

it("proves many distinct local wrappers without rescanning the program per wrapper", () => {
  const wrappers = Array.from(
    { length: DISTINCT_WRAPPER_COUNT },
    (_, wrapperIndex) =>
      `const openLink${wrapperIndex} = (url) => window.open(url); openLink${wrapperIndex}("/safe");`,
  ).join("\n");
  const result = runRule(windowOpenWithoutNoopener, wrappers);
  expect(result.diagnostics).toHaveLength(0);
});

it("keeps router reachability analysis bounded for many destination bindings", () => {
  const destinations = Array.from(
    { length: DISTINCT_ROUTER_DESTINATION_COUNT },
    (_, destinationIndex) =>
      `const destination${destinationIndex} = getDestination(${destinationIndex}); Router.push(destination${destinationIndex}); window.open(destination${destinationIndex});`,
  ).join("\n");
  const result = runRule(
    windowOpenWithoutNoopener,
    `import Router from "next/router"; const openAll = () => { ${destinations} };`,
  );
  expect(result.diagnostics).toHaveLength(DISTINCT_ROUTER_DESTINATION_COUNT);
});

it("proves repeated blob URLs without rescanning global mutations", () => {
  const popupCalls = Array.from(
    { length: REPEATED_BLOB_POPUP_COUNT },
    () => "window.open(URL.createObjectURL(blob));",
  ).join("\n");
  const result = runRule(windowOpenWithoutNoopener, `const openAll = (blob) => { ${popupCalls} };`);
  expect(result.diagnostics).toHaveLength(0);
});
