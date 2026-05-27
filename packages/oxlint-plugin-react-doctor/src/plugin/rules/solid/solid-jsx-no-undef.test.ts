import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidJsxNoUndef } from "./solid-jsx-no-undef.js";

describe("solid-jsx-no-undef", () => {
  it("flags undefined component", () => {
    const result = runRule(solidJsxNoUndef, `const element = <MyComponent />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe("'MyComponent' is not defined.");
  });

  it("flags root object of undefined member expression component", () => {
    const result = runRule(solidJsxNoUndef, `const element = <Foo.Bar />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe("'Foo' is not defined.");
  });

  it("flags undefined custom directive", () => {
    const result = runRule(solidJsxNoUndef, `const element = <div use:myDirective />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Custom directive 'myDirective'");
  });

  it("flags multiple undefined components", () => {
    const result = runRule(solidJsxNoUndef, `const element = <><Missing /><AlsoMissing /></>;`);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag imported component", () => {
    const result = runRule(
      solidJsxNoUndef,
      `import { Show } from "solid-js"; const element = <Show when={true}>hi</Show>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag locally declared arrow component", () => {
    const result = runRule(
      solidJsxNoUndef,
      `const MyComp = () => <div />; const element = <MyComp />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag locally declared function component", () => {
    const result = runRule(
      solidJsxNoUndef,
      `function MyComp() { return <div />; } const element = <MyComp />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag intrinsic elements", () => {
    const result = runRule(solidJsxNoUndef, `const element = <><div /><br /><span /></>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag defined member expression component", () => {
    const result = runRule(
      solidJsxNoUndef,
      `const Icons = { Star: () => <span /> }; const element = <Icons.Star />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag defined custom directive", () => {
    const result = runRule(
      solidJsxNoUndef,
      `const myDirective = (el: Element) => {}; const element = <div use:myDirective />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags deeply nested undefined member expression root", () => {
    const result = runRule(solidJsxNoUndef, `const element = <A.B.C />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe("'A' is not defined.");
  });

  it("does not flag default-imported component", () => {
    const result = runRule(solidJsxNoUndef, `import Card from "./card"; const element = <Card />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags Show when not imported", () => {
    const result = runRule(solidJsxNoUndef, `const element = <Show when={true}>hi</Show>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe("'Show' is not defined.");
  });

  it("flags For when not imported", () => {
    const result = runRule(
      solidJsxNoUndef,
      `const element = <For each={items}>{(item) => <div>{item}</div>}</For>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe("'For' is not defined.");
  });

  it("does not flag lowercase intrinsic elements like div, span, input", () => {
    const result = runRule(
      solidJsxNoUndef,
      `const element = <><div /><span /><input /><br /><hr /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag component defined via destructured import", () => {
    const result = runRule(
      solidJsxNoUndef,
      `import { Show, For } from "solid-js";
       const element = <><Show when={true}>hi</Show><For each={[]}>{(x) => <div />}</For></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
