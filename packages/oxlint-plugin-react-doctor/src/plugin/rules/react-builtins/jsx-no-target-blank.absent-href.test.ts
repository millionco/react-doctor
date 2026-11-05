import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoTargetBlank } from "./jsx-no-target-blank.js";

const settings = {
  "react-doctor": {
    capabilities: ["target-blank-needs-explicit-protection", "target-blank-needs-noreferrer"],
  },
  react: { linkComponents: ["Link"] },
};

describe("react-builtins/jsx-no-target-blank — absent native href", () => {
  it.each([
    'const Anchor = () => <a href={undefined} target="_blank" />;',
    'const Anchor = ({ getHref }) => <a href={(void getHref()) as undefined} target="_blank" />;',
  ])("ignores a definitely undefined native href: %s", (code) => {
    const result = runRule(jsxNoTargetBlank, code, { settings });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    'const Anchor = (undefined) => <a href={undefined} target="_blank" />;',
    'const Anchor = ({ href }) => <a href={href} target="_blank" />;',
    '<a href="https://example.test" target="_blank" />;',
    '<Link href={undefined} target="_blank" />;',
    '<Link href={void getHref()} target="_blank" />;',
    '<svg><a href={undefined} xlinkHref="https://example.test" target="_blank" /></svg>;',
    '<a href={undefined} HREF="https://example.test" target="_blank" />;',
    '<a is="custom-anchor" href={undefined} target="_blank" />;',
    '<svg><a {...{ xlinkHref: "https://example.test" }} href={undefined} target="_blank" /></svg>;',
    'function Anchor(props) { with (props) { return <a href={undefined} target="_blank" />; } }',
    'function Anchor(eval) { eval("var undefined = url"); return <a href={undefined} target="_blank" />; }',
  ])("retains uncertainty about the destination: %s", (code) => {
    const result = runRule(jsxNoTargetBlank, code, { settings });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
