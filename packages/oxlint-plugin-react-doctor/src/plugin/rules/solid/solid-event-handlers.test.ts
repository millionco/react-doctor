import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidEventHandlers } from "./solid-event-handlers.js";

describe("solid-event-handlers", () => {
  it("allows camelCase onClick with expression value", () => {
    const result = runRule(solidEventHandlers, `<button onClick={() => {}} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags lowercase onclick and suggests onClick", () => {
    const result = runRule(solidEventHandlers, `<button onclick={() => {}} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("onClick");
    expect(result.diagnostics[0].message).toContain("readability");
  });

  it("flags nonstandard onDoubleClick and suggests onDblClick", () => {
    const result = runRule(solidEventHandlers, `<button onDoubleClick={() => {}} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("onDblClick");
  });

  it("flags static string value on handler prop", () => {
    const result = runRule(solidEventHandlers, `<button onClick={"doSomething"} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("static string/number");
  });

  it("flags literal value on handler prop", () => {
    const result = runRule(solidEventHandlers, `<button onClick="doSomething" />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("literal value");
  });

  it("flags boolean-like handler (no value)", () => {
    const result = runRule(solidEventHandlers, `<button onClick />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("literal value");
  });

  it("flags ambiguous lowercase third character like onfoo", () => {
    const result = runRule(solidEventHandlers, `<button onfoo={() => {}} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("ambiguous");
    expect(result.diagnostics[0].message).toContain("onFoo");
  });

  it("does not flag non-event attributes", () => {
    const result = runRule(solidEventHandlers, `<button className="btn" id="x" />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag custom component elements", () => {
    const result = runRule(solidEventHandlers, `<MyButton onclick={() => {}} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects ignoreCase setting", () => {
    const result = runRule(solidEventHandlers, `<button onclick={() => {}} />`, {
      settings: { "react-doctor": { solidEventHandlers: { ignoreCase: true } } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags spread handlers when warnOnSpread is enabled", () => {
    const result = runRule(solidEventHandlers, `<button {...{ onClick: () => {} }} />`, {
      settings: { "react-doctor": { solidEventHandlers: { warnOnSpread: true } } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("spread");
  });

  it("does not flag spread handlers by default", () => {
    const result = runRule(solidEventHandlers, `<button {...{ onClick: () => {} }} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags static number value on handler prop", () => {
    const result = runRule(solidEventHandlers, `<button onClick={42} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("static string/number");
  });

  it("traces const variable holding a string to flag static value", () => {
    const result = runRule(
      solidEventHandlers,
      `const handler = "click";\n<button onClick={handler} />`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("static string/number");
  });

  it("traces chained const variables to flag static value", () => {
    const result = runRule(
      solidEventHandlers,
      `const a = "click";\nconst b = a;\n<button onClick={b} />`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("static string/number");
  });

  it("does not flag array expression handler (Solid tuple syntax)", () => {
    const result = runRule(solidEventHandlers, `<button onClick={[handler, data]} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags static template literal without expressions on handler prop", () => {
    const result = runRule(solidEventHandlers, "<button onClick={`doSomething`} />");
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("static string/number");
  });

  it("does not flag onCustomEvent with uppercase third character on DOM element", () => {
    const result = runRule(solidEventHandlers, `<div onCustomEvent={() => {}} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
