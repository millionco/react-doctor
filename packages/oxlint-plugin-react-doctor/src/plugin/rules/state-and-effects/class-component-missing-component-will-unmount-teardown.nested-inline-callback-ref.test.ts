import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

// Authored synthetic fixtures; no application source is embedded here.
const SOURCE = `import * as React from "react";
export class ScrollPanel extends React.Component {
  node;
  constructor(props) {
    super(props);
    this.onScroll = this.onScroll.bind(this);
  }
  componentDidMount() {
    this.node.addEventListener("scroll", this.onScroll);
  }
  componentWillUnmount() {
    this.node.removeEventListener("scroll", this.onScroll);
  }
  onScroll() { this.forceUpdate(); }
  render() {
    return <div><div ref={element => { this.node = element; }}><span>Content</span></div>{this.props.footer && <span>Footer</span>}</div>;
  }
}
`;

const MESSAGE =
  "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.";

const inspect = (source: string) => {
  const result = runRule(classComponentMissingComponentWillUnmountTeardown, source, {
    filename: "synthetic-fixed-child-class-ref.tsx",
    includeLocations: true,
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

const expectRegistrationWarning = (source: string) => {
  const registration = source.indexOf("this.node.addEventListener(");
  expect(registration).toBeGreaterThanOrEqual(0);
  const prefix = source.slice(0, registration);
  expect(inspect(source)).toEqual([
    {
      nodeType: "CallExpression",
      line: prefix.split("\n").length,
      column: registration - prefix.lastIndexOf("\n") - 1,
      message: MESSAGE,
    },
  ]);
};

describe("fixed first native child callback-ref teardown", () => {
  it("matches an inline assignment ref and one constructor-bound handler", () => {
    expect(inspect(SOURCE)).toEqual([]);
  });

  it("accepts explicit matching boolean capture", () => {
    expect(
      inspect(SOURCE.replaceAll('"scroll", this.onScroll)', '"scroll", this.onScroll, true)')),
    ).toEqual([]);
  });

  it.each([
    [
      "missing removal",
      SOURCE.replace('    this.node.removeEventListener("scroll", this.onScroll);', ""),
    ],
    [
      "different event",
      SOURCE.replace('removeEventListener("scroll"', 'removeEventListener("resize"'),
    ],
    [
      "different capture",
      SOURCE.replace(
        'removeEventListener("scroll", this.onScroll)',
        'removeEventListener("scroll", this.onScroll, true)',
      ),
    ],
    [
      "opaque event coercion",
      SOURCE.replaceAll('"scroll", this.onScroll', "this.props.event, this.onScroll"),
    ],
    [
      "opaque capture options",
      SOURCE.replaceAll('"scroll", this.onScroll)', '"scroll", this.onScroll, this.props.options)'),
    ],
    [
      "conditional target",
      SOURCE.replace(
        "<div ref={element => { this.node = element; }}><span>Content</span></div>",
        "{this.props.visible && <div ref={element => { this.node = element; }}><span>Content</span></div>}",
      ),
    ],
    ["keyed target", SOURCE.replace("<div ref=", "<div key={this.props.version} ref=")],
    ["keyed ancestor", SOURCE.replace("return <div>", "return <div key={this.props.version}>")],
    [
      "competing ref target",
      SOURCE.replace(
        "{this.props.footer && <span>Footer</span>}",
        "<div ref={element => { this.node = element; }}/>",
      ),
    ],
    [
      "handler rebound during unmount",
      SOURCE.replace(
        "    this.node.removeEventListener",
        "    this.onScroll = this.onScroll.bind(this);\n    this.node.removeEventListener",
      ),
    ],
    [
      "throwing cleanup prelude",
      SOURCE.replace(
        "    this.node.removeEventListener",
        "    mayThrow();\n    this.node.removeEventListener",
      ),
    ],
    [
      "custom ancestor",
      SOURCE.replace("return <div>", "return <Frame>").replace("</div>;\n", "</Frame>;\n"),
    ],
    [
      "unsupported host tag",
      SOURCE.replace("return <div>", "return <section>").replace("</div>;\n", "</section>;\n"),
    ],
    [
      "nested named ref",
      SOURCE.replace(
        "  onScroll() {",
        "  captureNode = element => { this.node = element; };\n  onScroll() {",
      ).replace("ref={element => { this.node = element; }}", "ref={this.captureNode}"),
    ],
  ])("retains the registration warning for %s", (_name, source) => {
    expectRegistrationWarning(source);
  });
});
