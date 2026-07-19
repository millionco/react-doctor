import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { styledComponentsDuplicateCssPropertyInBlock } from "./styled-components-duplicate-css-property-in-block.js";

const rule = styledComponentsDuplicateCssPropertyInBlock;
const runStyledRule = (source: string) =>
  runRule(rule, `import styled, { css } from "styled-components";\n${source}`);

describe("styled-components-duplicate-css-property-in-block", () => {
  it("flags a property declared twice as conditionals at the same level", () => {
    const result = runStyledRule(
      "const B = styled.div`padding-bottom: ${p => p.$isLayoutVariant ? '8px' : '0'}; padding-bottom: ${p => p.$isCtaVariant ? '4px' : '16px'};`;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags duplicates inside a css block", () => {
    const result = runStyledRule(
      "const shared = css`opacity: ${p => p.$a ? 1 : 0}; opacity: ${p => p.$b ? 1 : 0.5};`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a block-body return ternary duplicate", () => {
    const result = runStyledRule(
      "const B = styled.div`margin: ${p => { return p.$a ? '8px' : '0'; }}; margin: ${p => p.$b ? '4px' : '0'};`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Prettier-formatted paren-wrapped ternary arrow bodies", () => {
    const result = runStyledRule(
      'const B = styled.div`padding-bottom: ${(p) => (p.$isLayoutVariant ? "8px" : "0")}; padding-bottom: ${(p) => (p.$isCtaVariant ? "4px" : "16px")};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a duplicate whose last declaration omits the optional trailing semicolon", () => {
    const result = runStyledRule(
      "const B = styled.div`opacity: ${p => p.$a ? 1 : 0}; opacity: ${p => p.$b ? 1 : 0.5}`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a layered computed + conditional pair", () => {
    const result = runStyledRule(
      "const B = styled.div`opacity: ${p => getComputedOpacity(p)}; opacity: ${p => p.$isHidden ? 0 : 'inherit'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the same property in a nested pseudo-selector", () => {
    const result = runStyledRule(
      "const B = styled.div`padding-bottom: ${p => p.$a ? '8px' : '0'}; &:hover { padding-bottom: ${p => p.$b ? '4px' : '0'}; }`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the same property in distinct @media blocks", () => {
    const result = runStyledRule(
      "const B = styled.div`padding-bottom: ${p => p.$a ? '8px' : '0'}; @media (min-width: 700px) { padding-bottom: ${p => p.$b ? '4px' : '0'}; }`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag shorthand versus longhand", () => {
    const result = runStyledRule(
      "const B = styled.div`padding: ${p => p.$a ? '8px' : '0'}; padding-bottom: ${p => p.$b ? '4px' : '0'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reassigned custom properties", () => {
    const result = runStyledRule(
      "const B = styled.div`--gap: ${p => p.$a ? '8px' : '0'}; --gap: ${p => p.$b ? '4px' : '0'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag two static duplicate declarations", () => {
    const result = runStyledRule("const B = styled.div`color: red; color: blue;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single declaration", () => {
    const result = runStyledRule(
      "const B = styled.div`padding-bottom: ${p => p.$a ? '8px' : '0'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-styled template tag", () => {
    const result = runRule(
      rule,
      'const css = String.raw; const q = css`color: ${p => p.$a ? "x" : "y"}; color: ${p => p.$b ? "x" : "y"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports renamed styled-components imports", () => {
    const result = runRule(
      rule,
      'import styledFactory, { css as styleBlock } from "styled-components"; const B = styledFactory.div`color: ${p => p.$a ? "x" : "y"}; color: ${p => p.$b ? "x" : "y"};`; const shared = styleBlock`opacity: ${p => p.$a ? 1 : 0}; opacity: ${p => p.$b ? 1 : 0};`; ',
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag equivalent conditions whose callback parameters have different names", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${props => props.$fullHeight ? "100vh" : "auto"}; height: ${state => state.$fullHeight ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let braces and semicolons in comments or strings change CSS depth", () => {
    const result = runStyledRule(
      'const Button = styled.button`content: "};"; /* { ; } */ color: ${p => p.$primary ? "blue" : "gray"}; color: ${p => p.$danger ? "red" : "black"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks conditional interpolations inside quoted CSS values", () => {
    const result = runStyledRule(
      'const Button = styled.button`content: "${properties => properties.$primary ? "primary" : "default"}"; content: "${properties => properties.$danger ? "danger" : "default"}";`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let line comments hide declarations or change CSS depth", () => {
    const result = runStyledRule(
      'const Button = styled.button`// ignored { };\ncolor: ${p => p.$primary ? "blue" : "gray"}; // ignored }\ncolor: ${p => p.$danger ? "red" : "black"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not interpret URL protocol separators as line comments", () => {
    const result = runStyledRule(
      'const Button = styled.button`background: url(https://example.com/a.png); color: ${p => p.$primary ? "blue" : "gray"}; color: ${p => p.$danger ? "red" : "black"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let separators inside CSS functions change declaration boundaries", () => {
    const result = runStyledRule(
      'const Button = styled.button`background: url(data:image/svg+xml;utf8,<svg>{}</svg>); color: ${p => p.$primary ? "blue" : "gray"}; color: ${p => p.$danger ? "red" : "black"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag equivalent helper-call conditions with renamed callback parameters", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${props => isFullHeight(props) ? "100vh" : "auto"}; height: ${state => isFullHeight(state) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume repeated parameter-independent calls are stable", () => {
    const result = runStyledRule(
      'let flip = false; const next = () => flip = !flip; const Modal = styled.div`height: ${() => next() ? "100vh" : "auto"}; height: ${() => next() ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);

    const parameterResult = runStyledRule(
      'let flip = false; const next = (value) => (flip = !flip) && value; const Modal = styled.div`height: ${(properties) => next(properties.active) ? "100vh" : "auto"}; height: ${(state) => next(state.active) ? "100dvh" : "auto"};`;',
    );
    expect(parameterResult.diagnostics).toHaveLength(1);

    const declarationResult = runStyledRule(
      'let flip = false; function next(value) { flip = !flip; return flip && value; } const Modal = styled.div`height: ${(properties) => next(properties.active) ? "100vh" : "auto"}; height: ${(state) => next(state.active) ? "100dvh" : "auto"};`;',
    );
    expect(declarationResult.diagnostics).toHaveLength(1);

    const methodResult = runStyledRule(
      'let flip = false; const helper = { next(value) { flip = !flip; return flip && value; } }; const Modal = styled.div`height: ${(properties) => helper.next(properties.active) ? "100vh" : "auto"}; height: ${(state) => helper.next(state.active) ? "100dvh" : "auto"};`;',
    );
    expect(methodResult.diagnostics).toHaveLength(1);
  });

  it("does not flag equivalent static property keys that match one parameter name", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => properties.state ? "100vh" : "auto"}; height: ${state => state.state ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent renamed-parameter conditions with optional chaining", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => properties?.$fullHeight ? "100vh" : "auto"}; height: ${state => state.$fullHeight ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent optional calls with renamed callback parameters", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => properties.isFull?.() ? "100vh" : "auto"}; height: ${state => state.isFull() ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent computed and spread conditions with renamed parameters", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => matches(properties[properties.key], ...properties.values) ? "100vh" : "auto"}; height: ${state => matches(state[state.key], ...state.values) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent object and array arguments with renamed parameters", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => matches({ active: properties.active, values: [properties.value, ...properties.values] }) ? "100vh" : "auto"}; height: ${state => matches({ active: state.active, values: [state.value, ...state.values] }) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent regex literal conditions", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => /full/i.test(properties.mode) ? "100vh" : "auto"}; height: ${state => /full/i.test(state.mode) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("distinguishes regex literal flags in conditions", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => /full/i.test(properties.mode) ? "100vh" : "auto"}; height: ${state => /full/g.test(state.mode) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes different object and array arguments", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => matches({ active: properties.active, values: [properties.value] }) ? "100vh" : "auto"}; height: ${state => matches({ active: state.disabled, values: [state.value] }) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes different numeric object keys", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => matches({ 1: properties.active }) ? "100vh" : "auto"}; height: ${state => matches({ 2: state.active }) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag equivalent numeric object keys", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => matches({ 1: properties.active }) ? "100vh" : "auto"}; height: ${state => matches({ 1: state.active }) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent nested conditional tests with renamed parameters", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => (properties.compact ? properties.small : properties.large) ? "100vh" : "auto"}; height: ${state => (state.compact ? state.small : state.large) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("compares sequence and template expressions inside conditions", () => {
    const equivalentResult = runStyledRule(
      'const Modal = styled.div`height: ${properties => (track(properties), `${properties.mode}-full`) ? "100vh" : "auto"}; height: ${state => (track(state), `${state.mode}-full`) ? "100dvh" : "auto"};`;',
    );
    expect(equivalentResult.diagnostics).toHaveLength(0);

    const differentResult = runStyledRule(
      'const Modal = styled.div`height: ${properties => (track(properties), `${properties.mode}-full`) ? "100vh" : "auto"}; height: ${state => (track(state), `${state.mode}-compact`) ? "100dvh" : "auto"};`;',
    );
    expect(differentResult.diagnostics).toHaveLength(1);
  });

  it("does not flag equivalent this conditions in function callbacks", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${function (properties) { return this.isFull ? "100vh" : "auto"; }}; height: ${function (state) { return this.isFull ? "100dvh" : "auto"; }};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent conditions with a defaulted renamed parameter", () => {
    const result = runStyledRule(
      'const fallback = { $fullHeight: false }; const Modal = styled.div`height: ${(properties = fallback) => properties.$fullHeight ? "100vh" : "auto"}; height: ${state => state.$fullHeight ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent conditions with renamed rest parameters", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${(...properties) => properties[0].$fullHeight ? "100vh" : "auto"}; height: ${(...state) => state[0].$fullHeight ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag equivalent destructured parameter bindings", () => {
    const objectResult = runStyledRule(
      'const Modal = styled.div`height: ${({ active }) => active ? "100vh" : "auto"}; height: ${({ active: enabled }) => enabled ? "100dvh" : "auto"};`;',
    );
    expect(objectResult.diagnostics).toHaveLength(0);

    const arrayResult = runStyledRule(
      'const Modal = styled.div`height: ${([active]) => active ? "100vh" : "auto"}; height: ${([enabled]) => enabled ? "100dvh" : "auto"};`;',
    );
    expect(arrayResult.diagnostics).toHaveLength(0);
  });

  it("distinguishes different destructured parameter sources", () => {
    const objectResult = runStyledRule(
      'const Modal = styled.div`height: ${({ active: value }) => value ? "100vh" : "auto"}; height: ${({ disabled: value }) => value ? "100dvh" : "auto"};`;',
    );
    expect(objectResult.diagnostics).toHaveLength(1);

    const arrayResult = runStyledRule(
      'const Modal = styled.div`height: ${([value]) => value ? "100vh" : "auto"}; height: ${([, value]) => value ? "100dvh" : "auto"};`;',
    );
    expect(arrayResult.diagnostics).toHaveLength(1);
  });

  it("distinguishes different destructured property defaults", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${({ active = true }) => active ? "100vh" : "auto"}; height: ${({ active = false }) => active ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes dynamic destructured property sources", () => {
    const result = runStyledRule(
      'const firstKey = "active"; const secondKey = "disabled"; const Modal = styled.div`height: ${({ [firstKey]: active }) => active ? "100vh" : "auto"}; height: ${({ [secondKey]: active }) => active ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes callback parameter positions", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${(properties, other) => properties.active ? "100vh" : "auto"}; height: ${(other, properties) => properties.active ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes dotted keys from nested property paths", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${({ "a.b": active }) => active ? "100vh" : "auto"}; height: ${({ a: { b: active } }) => active ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes object rest exclusion sets", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${({ "a,b": omitted, ...rest }) => rest.a ? "100vh" : "auto"}; height: ${({ a: first, b: second, ...rest }) => rest.a ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("matches member reads with equivalent destructured bindings", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => properties.active ? "100vh" : "auto"}; height: ${({ active: enabled }) => enabled ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches array rest members to their original offsets", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${(properties) => properties.items[1].active ? "100vh" : "auto"}; height: ${({ items: [first, ...rest] }) => rest[0].active ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches root rest parameters to their argument positions", () => {
    const equivalentResult = runStyledRule(
      'const Modal = styled.div`height: ${(...parameters) => parameters[0].active ? "100vh" : "auto"}; height: ${(properties) => properties.active ? "100dvh" : "auto"};`;',
    );
    expect(equivalentResult.diagnostics).toHaveLength(0);

    const differentResult = runStyledRule(
      'const Modal = styled.div`height: ${(...parameters) => parameters[0].active ? "100vh" : "auto"}; height: ${(properties) => properties[0].active ? "100dvh" : "auto"};`;',
    );
    expect(differentResult.diagnostics).toHaveLength(1);
  });

  it("does not treat noncanonical array rest keys as offsets", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${([first, ...rest]) => rest["01"].active ? "100vh" : "auto"}; height: ${(properties) => properties[1].active ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves callback-local const initializers", () => {
    const differentResult = runStyledRule(
      'const Modal = styled.div`height: ${(properties) => { const active = properties.a; return active ? "100vh" : "auto"; }}; height: ${(properties) => { const active = properties.b; return active ? "100dvh" : "auto"; }};`;',
    );
    expect(differentResult.diagnostics).toHaveLength(1);

    const equivalentResult = runStyledRule(
      'const Modal = styled.div`height: ${(properties) => { const active = properties.a; return active ? "100vh" : "auto"; }}; height: ${(state) => { const enabled = state.a; return enabled ? "100dvh" : "auto"; }};`;',
    );
    expect(equivalentResult.diagnostics).toHaveLength(0);

    const directResult = runStyledRule(
      'const Modal = styled.div`height: ${(properties) => { const active = properties.a; return active ? "100vh" : "auto"; }}; height: ${(state) => state.a ? "100dvh" : "auto"};`;',
    );
    expect(directResult.diagnostics).toHaveLength(0);

    const destructuredResult = runStyledRule(
      'const Modal = styled.div`height: ${(properties) => { const { active } = properties; return active ? "100vh" : "auto"; }}; height: ${(state) => state.active ? "100dvh" : "auto"};`;',
    );
    expect(destructuredResult.diagnostics).toHaveLength(0);

    const helperResult = runStyledRule(
      'const Modal = styled.div`height: ${(properties) => { const active = isFullHeight(properties); return active ? "100vh" : "auto"; }}; height: ${(state) => isFullHeight(state) ? "100dvh" : "auto"};`;',
    );
    expect(helperResult.diagnostics).toHaveLength(0);
  });

  it("preserves bindings alongside object rest parameters", () => {
    const directBindingResult = runStyledRule(
      'const Modal = styled.div`height: ${properties => properties.active ? "100vh" : "auto"}; height: ${({ active: enabled, ...rest }) => enabled ? "100dvh" : "auto"};`;',
    );
    expect(directBindingResult.diagnostics).toHaveLength(0);

    const restBindingResult = runStyledRule(
      'const Modal = styled.div`height: ${({ active, ...remaining }) => remaining.disabled ? "100vh" : "auto"}; height: ${({ active: enabled, ...rest }) => rest.disabled ? "100dvh" : "auto"};`;',
    );
    expect(restBindingResult.diagnostics).toHaveLength(0);
  });

  it("does not distinguish shorthand from explicit object properties", () => {
    const result = runStyledRule(
      'const active = true; const Modal = styled.div`height: ${properties => matches({ active }) ? "100vh" : "auto"}; height: ${state => matches({ active: active }) ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("normalizes static computed members and object keys", () => {
    const memberResult = runStyledRule(
      'const flags = { active: true }; const Modal = styled.div`height: ${() => flags.active ? "100vh" : "auto"}; height: ${() => flags["active"] ? "100dvh" : "auto"};`;',
    );
    expect(memberResult.diagnostics).toHaveLength(0);

    const propertyResult = runStyledRule(
      'const Modal = styled.div`height: ${(properties) => matches({ ["active"]: properties.active }) ? "100vh" : "auto"}; height: ${(state) => matches({ active: state.active }) ? "100dvh" : "auto"};`;',
    );
    expect(propertyResult.diagnostics).toHaveLength(0);
  });

  it("compares cooked template literal values", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${(properties) => `${properties.mode}\\x61` ? "100vh" : "auto"}; height: ${(state) => `${state.mode}a` ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("distinguishes different static property keys that match each parameter name", () => {
    const result = runStyledRule(
      'const Modal = styled.div`height: ${properties => properties.properties ? "100vh" : "auto"}; height: ${state => state.state ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes a callback parameter from a same-named outer binding", () => {
    const result = runStyledRule(
      'const props = { $fullHeight: false }; const Modal = styled.div`height: ${props => props.$fullHeight ? "100vh" : "auto"}; height: ${state => props.$fullHeight ? "100dvh" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags conflicting conditional duplicates after a base declaration", () => {
    const result = runStyledRule(
      'const Button = styled.button`color: gray; color: ${p => p.$primary ? "blue" : "gray"}; color: ${p => p.$danger ? "red" : "black"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags duplicates after a standalone mixin interpolation", () => {
    const result = runStyledRule(
      'const baseStyles = css`display: block;`; const Button = styled.button`${baseStyles}\ncolor: ${p => p.$primary ? "blue" : "gray"}; color: ${p => p.$danger ? "red" : "black"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a pending declaration before a nested block", () => {
    const result = runStyledRule(
      'const Button = styled.button`color: ${p => p.$primary ? "blue" : "gray"}\n&:hover { opacity: 0.8; } color: ${p => p.$danger ? "red" : "black"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a shadowed styled-components css helper", () => {
    const result = runStyledRule(
      'const build = () => { const css = String.raw; return css`color: ${p => p.$a ? "red" : "blue"}; color: ${p => p.$b ? "black" : "white"};`; };',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports parenthesized named and namespace css helper tags", () => {
    const result = runRule(
      rule,
      'import { css as styleBlock } from "styled-components"; import * as styles from "styled-components"; const first = (styleBlock)`color: ${p => p.$a ? "red" : "blue"}; color: ${p => p.$b ? "black" : "white"};`; const second = (styles.css)`opacity: ${p => p.$a ? 1 : 0}; opacity: ${p => p.$b ? 1 : 0};`;',
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports const aliases of css helper imports", () => {
    const result = runStyledRule(
      'const styleBlock = css; const shared = styleBlock`color: ${p => p.$primary ? "blue" : "gray"}; color: ${p => p.$danger ? "red" : "black"};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports namespace and namespace-member const aliases of css helpers", () => {
    const result = runRule(
      rule,
      'import * as styles from "styled-components"; const namespaceAlias = styles; const first = namespaceAlias.css`color: ${p => p.$primary ? "blue" : "gray"}; color: ${p => p.$danger ? "red" : "black"};`; const styleBlock = styles.css; const second = styleBlock`opacity: ${p => p.$primary ? 1 : 0}; opacity: ${p => p.$danger ? 0.5 : 0};`; const third = styles["css"]`width: ${p => p.$wide ? "100%" : "auto"}; width: ${p => p.$narrow ? "50%" : "auto"};`;',
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not flag the dvh-with-vh fallback under one condition", () => {
    const result = runStyledRule(
      "const Modal = styled.div`\n" +
        '  height: ${(p) => (p.$fullHeight ? "100vh" : "auto")};\n' +
        '  height: ${(p) => (p.$fullHeight ? "100dvh" : "auto")};\n' +
        "`;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a vendor-value fallback pair under one condition", () => {
    const result = runStyledRule(
      "const Row = styled.div`\n" +
        '  width: ${(p) => (p.$stretch ? "-webkit-fill-available" : "auto")};\n' +
        '  width: ${(p) => (p.$stretch ? "fill-available" : "auto")};\n' +
        "`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an earlier conflicting condition before an equivalent fallback pair", () => {
    const result = runStyledRule(
      "const Modal = styled.div`\n" +
        '  height: ${(properties) => (properties.compact ? "50vh" : "auto")} !important;\n' +
        '  height: ${(properties) => (properties.full ? "100vh" : "auto")};\n' +
        '  height: ${(properties) => (properties.full ? "100dvh" : "auto")} !important;\n' +
        "`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags duplicates with different conditions", () => {
    const result = runStyledRule(
      "const Button = styled.button`\n" +
        '  color: ${(p) => (p.$primary ? "blue" : "gray")};\n' +
        '  color: ${(p) => (p.$danger ? "red" : "black")};\n' +
        "`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a later conditional declaration with a flattened empty branch", () => {
    for (const emptyValue of ["undefined", "null", "false", '""']) {
      const result = runStyledRule(
        `const Button = styled.button\`color: \${properties => properties.primary ? "red" : "blue"}; color: \${properties => properties.secondary ? "green" : ${emptyValue}};\`;`,
      );
      expect(result.diagnostics).toHaveLength(0);
    }

    const progressiveEnhancementResult = runStyledRule(
      'const Button = styled.button`height: ${properties => properties.full ? "100vh" : "auto"}; height: ${properties => properties.full ? "100dvh" : "auto"}; height: ${properties => properties.compact ? "50vh" : undefined};`;',
    );
    expect(progressiveEnhancementResult.diagnostics).toHaveLength(0);

    const nestedFlattenedResult = runStyledRule(
      'const Button = styled.button`color: ${properties => properties.primary ? "red" : "blue"}; color: ${properties => properties.secondary ? (properties.tertiary ? "green" : undefined) : undefined};`;',
    );
    expect(nestedFlattenedResult.diagnostics).toHaveLength(0);

    const flattenedMiddleResult = runStyledRule(
      'const Button = styled.button`height: ${properties => properties.full ? "100vh" : "auto"}; height: ${properties => properties.compact ? "50vh" : undefined}; height: ${properties => properties.full ? "100dvh" : "auto"};`;',
    );
    expect(flattenedMiddleResult.diagnostics).toHaveLength(0);

    const flattenedImportantResult = runStyledRule(
      'const Button = styled.button`height: ${properties => properties.full ? "100vh" : "auto"}; height: ${properties => properties.compact ? "50vh" : undefined} !important; height: ${properties => properties.tall ? "100dvh" : "auto"};`;',
    );
    expect(flattenedImportantResult.diagnostics).toHaveLength(1);
  });

  it("respects important declaration precedence", () => {
    const earlierImportantResult = runStyledRule(
      'const Button = styled.button`color: ${properties => properties.primary ? "red" : "blue"} !important; color: ${properties => properties.secondary ? "green" : "black"};`;',
    );
    expect(earlierImportantResult.diagnostics).toHaveLength(0);

    const laterImportantResult = runStyledRule(
      'const Button = styled.button`color: ${properties => properties.primary ? "red" : "blue"}; color: ${properties => properties.secondary ? "green" : "black"} !important;`;',
    );
    expect(laterImportantResult.diagnostics).toHaveLength(1);

    const interveningImportantResult = runStyledRule(
      'const Button = styled.button`color: ${properties => properties.primary ? "red" : "blue"}; color: red !important; color: ${properties => properties.secondary ? "green" : "black"};`;',
    );
    expect(interveningImportantResult.diagnostics).toHaveLength(0);
  });
});
