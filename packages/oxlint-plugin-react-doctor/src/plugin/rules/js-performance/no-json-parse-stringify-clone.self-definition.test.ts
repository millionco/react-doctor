import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";

interface StructuredCloneSelfDefinitionCase {
  name: string;
  code: string;
  expectedCount: number;
}
const commonOptions: RunRuleOptions = {
  filename: "src/clone-example.tsx",
  forceJsx: true,
  includeLocations: true,
};
const cases: StructuredCloneSelfDefinitionCase[] = [
  {
    name: "direct-global-arrow",
    code: "global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 0,
  },
  {
    name: "direct-global-function",
    code: "global.structuredClone = function (value) { return JSON.parse(JSON.stringify(value)); };\n",
    expectedCount: 0,
  },
  {
    name: "canonical-jest-implementation",
    code: "global.structuredClone = jest.fn(function (value) { return JSON.parse(JSON.stringify(value)); });\n",
    expectedCount: 0,
  },
  {
    name: "direct-global-this-arrow",
    code: "globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 0,
  },
  {
    name: "local-unqualified-clone-delegate",
    code: "const structuredClone = delegate; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "clone-delegate-parameter",
    code: "global.structuredClone = (value, structuredClone) => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "shadowed-global-root",
    code: "const global = {}; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "shadowed-jest-provider",
    code: "const jest = { fn: callback => callback }; global.structuredClone = jest.fn(value => JSON.parse(JSON.stringify(value)));\n",
    expectedCount: 1,
  },
  {
    name: "unknown-wrapper",
    code: "global.structuredClone = wrap(value => JSON.parse(JSON.stringify(value)));\n",
    expectedCount: 1,
  },
  {
    name: "jest-wrapper-extra-argument",
    code: "global.structuredClone = jest.fn(value => JSON.parse(JSON.stringify(value)), undefined);\n",
    expectedCount: 1,
  },
  {
    name: "aliased-implementation",
    code: "const implementation = value => JSON.parse(JSON.stringify(value)); global.structuredClone = implementation;\n",
    expectedCount: 1,
  },
  {
    name: "aliased-global-owner",
    code: "const host = global; host.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "different-installed-api",
    code: "global.copyValue = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "nested-helper-body",
    code: "global.structuredClone = value => { const readValue = item => JSON.parse(JSON.stringify(item)); return readValue(value); };\n",
    expectedCount: 1,
  },
  {
    name: "asynchronous-implementation",
    code: "global.structuredClone = async value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "computed-installed-member",
    code: 'global["structuredClone"] = value => JSON.parse(JSON.stringify(value));\n',
    expectedCount: 1,
  },
  {
    name: "later-selected-api-replacement",
    code: "global.structuredClone = value => JSON.parse(JSON.stringify(value)); global.structuredClone = replacement;\n",
    expectedCount: 1,
  },
  {
    name: "replaced-jest-method",
    code: "jest.fn = callback => callback; global.structuredClone = jest.fn(value => JSON.parse(JSON.stringify(value)));\n",
    expectedCount: 1,
  },
  {
    name: "ordinary-application-clone",
    code: "export const duplicateValue = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "legacy-serialization-exclusion",
    code: "function serializeRecord(value) { return JSON.parse(JSON.stringify(value)); }\n",
    expectedCount: 0,
  },
  {
    name: "optional-jest-call",
    code: "global.structuredClone = jest.fn?.(value => JSON.parse(JSON.stringify(value)));\n",
    expectedCount: 1,
  },
  {
    name: "genuine-eval-read",
    code: "void eval; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "ordinary-global-read",
    code: "void console; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 0,
  },
  {
    name: "fake-json-receiver",
    code: "const JSON = {parse: value => value, stringify: value => value}; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "whole-global-exposure",
    code: "const host = global; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "global-self-exposure",
    code: "void globalThis.window; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "whole-jest-exposure",
    code: "const factory = jest.fn; global.structuredClone = jest.fn(value => JSON.parse(JSON.stringify(value)));\n",
    expectedCount: 1,
  },
  {
    name: "selected-api-exposure",
    code: "void global.structuredClone; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "selected-api-destructure",
    code: "const {structuredClone: delegate} = global; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "unrelated-global-writes",
    code: 'global.Headers = HeaderClass; if (typeof global.TextEncoder === "undefined") global.TextEncoder = EncoderClass; global.structuredClone = jest.fn(value => JSON.parse(JSON.stringify(value)));\n',
    expectedCount: 0,
  },
  {
    name: "window-owner",
    code: "window.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 0,
  },
  {
    name: "self-owner",
    code: "self.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 0,
  },
  {
    name: "shadowed-window-owner",
    code: "const window = {}; window.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "named-unqualified-self-binding",
    code: "global.structuredClone = function structuredClone(value) { return JSON.parse(JSON.stringify(value)); };\n",
    expectedCount: 1,
  },
  {
    name: "generator-implementation",
    code: "global.structuredClone = function* (value) { return JSON.parse(JSON.stringify(value)); };\n",
    expectedCount: 1,
  },
  {
    name: "runtime-enum-carrier",
    code: "enum Carrier { Value = 1 } global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "erased-type-control",
    code: "interface Payload { name: string } global.structuredClone = (value: Payload) => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 0,
  },
  {
    name: "erased-global-name-runtime",
    code: "interface global {} void global; globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "type-only-provider-runtime",
    code: 'import type { jest } from "types"; void jest; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n',
    expectedCount: 1,
  },
  {
    name: "different-mock-return-role",
    code: "global.structuredClone = jest.fn(value => { consume(JSON.parse(JSON.stringify(value))); return value; });\n",
    expectedCount: 1,
  },
  {
    name: "document-default-view-selected-replacement",
    code: "window.structuredClone = value => JSON.parse(JSON.stringify(value)); document.defaultView.structuredClone = replacement;\n",
    expectedCount: 1,
  },
  {
    name: "computed-document-default-view-replacement",
    code: 'window.structuredClone = value => JSON.parse(JSON.stringify(value)); document["defaultView"].structuredClone = replacement;\n',
    expectedCount: 1,
  },
  {
    name: "ordinary-document-title-profile-abstention",
    code: "void document.title; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n",
    expectedCount: 1,
  },
  {
    name: "unrelated-shadowed-local-document",
    code: 'const document = { title: "ready" }; void document.title; global.structuredClone = value => JSON.parse(JSON.stringify(value));\n',
    expectedCount: 0,
  },
  {
    name: "qualified-window-document-selected-replacement",
    code: "window.structuredClone = value => JSON.parse(JSON.stringify(value)); window.document.defaultView.structuredClone = replacement;\n",
    expectedCount: 1,
  },
];
describe("structuredClone self-definition remediation", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noJsonParseStringifyClone, code, commonOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
