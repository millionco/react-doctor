import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { styledComponentsNonTransientCustomPropOnIntrinsicElement } from "./styled-components-non-transient-custom-prop-on-intrinsic-element.js";

const rule = styledComponentsNonTransientCustomPropOnIntrinsicElement;

describe("styled-components-non-transient-custom-prop-on-intrinsic-element", () => {
  it("flags a custom boolean prop on styled.div", () => {
    const result = runRule(rule, "const D = styled.div<{ selected: boolean }>`color: red;`;");
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an invented prop on styled.button", () => {
    const result = runRule(rule, "const B = styled.button<{ active: boolean }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags backgroundImage on styled.div", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ backgroundImage: string }>`background: none;`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags multiple invented props", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ isTarget: boolean; showActions: boolean; grabbing: boolean }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not flag transient $-prefixed props", () => {
    const result = runRule(rule, "const D = styled.div<{ $active: boolean }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag styled(Component) wrapping a component", () => {
    const result = runRule(rule, "const D = styled(Base)<{ active: boolean }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a custom prop behind an .attrs() chain — .attrs merges attributes and strips nothing", () => {
    const result = runRule(
      rule,
      'const B = styled.button.attrs({ type: "button" })<{ active: boolean }>`color: red;`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag withConfig chains where shouldForwardProp can filter the prop", () => {
    const result = runRule(
      rule,
      "const D = styled.div.withConfig({ shouldForwardProp: (prop) => prop !== 'active' })<{ active: boolean }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags custom props behind displayName-only withConfig chains", () => {
    const result = runRule(
      rule,
      "const D = styled.div.withConfig({ displayName: 'D' })<{ active: boolean }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag @emotion/styled, which filters invalid props on string tags by default", () => {
    const result = runRule(
      rule,
      'import styled from "@emotion/styled";\nconst D = styled.div<{ active: boolean }>`color: red;`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag @linaria/react styled, a different library sharing the tagged-template syntax", () => {
    const result = runRule(
      rule,
      'import { styled } from "@linaria/react";\nconst D = styled.div<{ active: boolean }>`color: red;`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a same-file object named styled", () => {
    const result = runRule(
      styledComponentsNonTransientCustomPropOnIntrinsicElement,
      "const styled = makeTemplateFactory();\nconst D = styled.div<{ active: boolean }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when styled is explicitly imported from styled-components", () => {
    const result = runRule(
      rule,
      'import styled from "styled-components";\nconst D = styled.div<{ active: boolean }>`color: red;`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag theme, the per-component theme-typing idiom consumed internally by styled-components", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ theme: AppTheme }>`color: ${(p) => p.theme.text};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag as / forwardedAs, polymorphic props consumed internally by styled-components", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ as: string; forwardedAs: string }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag valid element-specific attributes on their tag", () => {
    const cases = [
      "const I = styled.input<{ value: string }>`color: red;`;",
      "const I = styled.input<{ checked: boolean }>`color: red;`;",
      "const M = styled.img<{ loading: string }>`color: red;`;",
      "const T = styled.details<{ open: boolean }>`color: red;`;",
      "const S = styled.select<{ multiple: boolean }>`color: red;`;",
      "const X = styled.textarea<{ rows: number }>`color: red;`;",
    ];
    for (const code of cases) {
      const result = runRule(rule, code);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("does not flag global attributes on any tag", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ id: string; role: string; title: string; hidden: boolean; tabIndex: number }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag svg fill on svg", () => {
    const result = runRule(rule, "const S = styled.svg<{ fill: string }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag data-* / aria-* string keys", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ 'data-testid': string; 'aria-label': string }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags unknown on-prefixed props that are not DOM events", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ onCustomThing: () => void }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag styled.div without a generic", () => {
    const result = runRule(rule, "const D = styled.div`color: red;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags custom props declared through a same-file named interface (dtale slider idiom)", () => {
    const result = runRule(
      rule,
      `import styled from "styled-components";
      interface StyledState { index: number; value: number; valueNow: number }
      export const StyledTrack = styled.div<StyledState>\`background: \${(props) => (props.index === 1 ? '#2a91d1' : '#ddd')};\`;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still flags every generic member of an exported styled intrinsic even when same-file usages pass only one (dtale accepted-noise shape)", () => {
    const result = runRule(
      rule,
      `import styled from "styled-components";
      interface StyledState { index: number; valueNow: number }
      export const StyledTrack = styled.div<StyledState>\`background: \${(props) => (props.index === 1 ? '#2a91d1' : '#ddd')};\`;
      export const Track = (props, state) => <StyledTrack {...props} index={state.index} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags custom props declared through a same-file type alias to a type literal", () => {
    const result = runRule(
      rule,
      "type TrackProps = { active: boolean };\nconst T = styled.div<TrackProps>`color: red;`;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a same-file named interface whose props are all transient", () => {
    const result = runRule(
      rule,
      "interface TrackProps { $index: number }\nconst T = styled.div<TrackProps>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an imported (cross-file) prop type reference", () => {
    const result = runRule(
      rule,
      'import styled from "styled-components";\nimport type { TrackProps } from "./types";\nconst T = styled.div<TrackProps>`color: red;`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a same-file generic interface reference", () => {
    const result = runRule(
      rule,
      "interface TrackProps<T> { active: T }\nconst T = styled.div<TrackProps<boolean>>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags custom props declared through an intersection", () => {
    const result = runRule(
      rule,
      "type TrackProps = { active: boolean } & { hovered: boolean };\nconst T = styled.div<TrackProps>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags selected on div but not on option", () => {
    const div = runRule(rule, "const D = styled.div<{ selected: boolean }>`color: red;`;");
    expect(div.diagnostics).toHaveLength(1);
    const option = runRule(rule, "const O = styled.option<{ selected: boolean }>`color: red;`;");
    expect(option.diagnostics).toHaveLength(0);
  });

  it("does not flag a local styled component whose only usage destructures the prop away before spreading", () => {
    const result = runRule(
      rule,
      [
        "interface HtmlAWithRefProps { children: ReactNode; forwardedRef?: React.Ref<HTMLAnchorElement> }",
        "const Ahref = styled.a<HtmlAWithRefProps>`color: red;`;",
        "export const HtmlA = ({ forwardedRef, ...passProps }: HtmlAWithRefProps) => (",
        "  <Ahref ref={forwardedRef} {...passProps} />",
        ");",
      ].join("\n"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when a local usage passes the custom prop explicitly", () => {
    const result = runRule(
      rule,
      [
        "const Track = styled.div<{ index: number }>`color: red;`;",
        "export const Slider = (state: { index: number }) => <Track index={state.index} />;",
      ].join("\n"),
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when a local usage spreads props that were not destructured away", () => {
    const result = runRule(
      rule,
      [
        "const Track = styled.div<{ index: number }>`color: red;`;",
        "export const Slider = (props: { index: number }) => <Track {...props} />;",
      ].join("\n"),
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an exported styled component regardless of local usage", () => {
    const result = runRule(
      rule,
      [
        "export const Track = styled.div<{ index: number }>`color: red;`;",
        "const Slider = ({ index, ...rest }: { index: number }) => <Track {...rest} />;",
      ].join("\n"),
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a local styled component with a non-JSX escaping reference", () => {
    const result = runRule(
      rule,
      [
        "const Track = styled.div<{ index: number }>`color: red;`;",
        "const Wide = styled(Track)`width: 100%;`;",
        "export const Slider = ({ index, ...rest }: { index: number }) => <Track {...rest} />;",
      ].join("\n"),
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a local styled component with no JSX usage at all", () => {
    const result = runRule(rule, "const Track = styled.div<{ index: number }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("audit regressions", () => {
  it("includes custom props inherited from same-file interfaces", () => {
    const result = runRule(
      styledComponentsNonTransientCustomPropOnIntrinsicElement,
      `import styled from "styled-components";
       interface InteractiveProps { active: boolean }
       interface ButtonProps extends InteractiveProps { disabled?: boolean }
       export const Button = styled.button<ButtonProps>\`\`;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("includes custom props from every merged interface declaration", () => {
    const result = runRule(
      styledComponentsNonTransientCustomPropOnIntrinsicElement,
      `import styled from "styled-components";
       interface ButtonProps { $internal: boolean }
       interface ButtonProps { active: boolean }
       export const Button = styled.button<ButtonProps>\`\`;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags unknown event-looking props", () => {
    const result = runRule(
      styledComponentsNonTransientCustomPropOnIntrinsicElement,
      `import styled from "styled-components"; export const B = styled.button<{ onMagic: () => void }>\`\`;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves local JSX usage by binding identity", () => {
    const result = runRule(
      styledComponentsNonTransientCustomPropOnIntrinsicElement,
      `import styled from "styled-components"; const S = styled.div<{ custom: boolean }>\`\`; const C = () => { const S = Other; return <S custom />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports aliased styled-components imports", () => {
    const result = runRule(
      styledComponentsNonTransientCustomPropOnIntrinsicElement,
      `import sc from "styled-components"; export const S = sc.div<{ custom: boolean }>\`\`;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
