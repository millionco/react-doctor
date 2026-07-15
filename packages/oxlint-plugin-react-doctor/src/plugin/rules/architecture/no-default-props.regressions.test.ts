import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDefaultProps } from "./no-default-props.js";

describe("architecture/no-default-props — regressions", () => {
  describe("class receivers", () => {
    it("stays silent for the D-Tale React class component", () => {
      const result = runRule(
        noDefaultProps,
        `import React, { Component } from "react";
class Wordcloud extends Component {
  render() {
    return <output>{this.props.height}</output>;
  }
}
Wordcloud.defaultProps = { height: 400 };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags the equivalent function component", () => {
      const result = runRule(
        noDefaultProps,
        `const Wordcloud = (props) => <output>{props.height}</output>;
Wordcloud.defaultProps = { height: 400 };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it.each([
      [
        "renamed Component import",
        `import { Component as BaseComponent } from "react";
class Wordcloud extends BaseComponent {}
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "renamed PureComponent import",
        `import { PureComponent as BaseComponent } from "react";
class Wordcloud extends BaseComponent {}
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "React namespace Component",
        `import * as React from "react";
class Wordcloud extends React.Component {}
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "React namespace PureComponent",
        `import * as React from "react";
class Wordcloud extends React.PureComponent {}
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "intermediate subclass",
        `import { Component } from "react";
class BaseWordcloud extends Component {}
class Wordcloud extends BaseWordcloud {}
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "class expression",
        `import { Component } from "react";
const Wordcloud = class extends Component {};
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "named class expression",
        `import { Component } from "react";
const Wordcloud = class WordcloudComponent extends Component {};
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "type-asserted class expression",
        `import { Component } from "react";
const Wordcloud = (class extends Component {}) as typeof Component;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "satisfies-wrapped class expression",
        `import { Component } from "react";
const Wordcloud = (class extends Component {}) satisfies typeof Component;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "stable const alias chain",
        `import { Component } from "react";
class WordcloudClass extends Component {}
const WordcloudAlias = WordcloudClass;
const Wordcloud = WordcloudAlias;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "class captured before its binding changes",
        `class WordcloudClass {}
const Wordcloud = WordcloudClass;
WordcloudClass = () => null;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "alias captured before an earlier alias changes",
        `class WordcloudClass {}
const WordcloudAlias = WordcloudClass;
const Wordcloud = WordcloudAlias;
WordcloudAlias = () => null;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "userland class",
        `class Wordcloud {}
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "shadowing class",
        `const Wordcloud = () => null;
{
  class Wordcloud {}
  Wordcloud.defaultProps = { height: 400 };
}`,
      ],
    ])("stays silent for a %s receiver", (_description, source) => {
      const result = runRule(noDefaultProps, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      [
        "reassigned class binding",
        `class Wordcloud {}
Wordcloud = () => null;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "class binding changed before the alias captures it",
        `class WordcloudClass {}
WordcloudClass = () => null;
const Wordcloud = WordcloudClass;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "alias changed before the next alias captures it",
        `class WordcloudClass {}
const WordcloudAlias = WordcloudClass;
WordcloudAlias = () => null;
const Wordcloud = WordcloudAlias;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "mutable alias",
        `class WordcloudClass {}
let Wordcloud = WordcloudClass;
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "opaque import",
        `import { Wordcloud } from "./wordcloud";
Wordcloud.defaultProps = { height: 400 };`,
      ],
      ["unresolved receiver", `Wordcloud.defaultProps = { height: 400 };`],
      [
        "HOC result",
        `import { memo } from "react";
const Wordcloud = memo(() => null);
Wordcloud.defaultProps = { height: 400 };`,
      ],
      [
        "shadowed function",
        `class Wordcloud {}
{
  const Wordcloud = () => null;
  Wordcloud.defaultProps = { height: 400 };
}`,
      ],
    ])("still flags a %s receiver", (_description, source) => {
      const result = runRule(noDefaultProps, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("uses the reaching class value before a later reassignment", () => {
      const result = runRule(
        noDefaultProps,
        `class Wordcloud {}
Wordcloud.defaultProps = { height: 400 };
Wordcloud = () => null;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  // FN hunt (innovaccer design-system): the rule fired zero times across the
  // whole corpus because `defaultEnabled: false` kept it out of the default
  // scan set ON TOP of the `react:19` gate — double-gated into permanent
  // silence. The version gate itself is correct (`defaultProps` still works
  // on React 17/18, so the removal hint is noise there); pin that exact
  // wiring: on by default, gated to React 19+ and nothing more.
  it("is enabled by default, gated only by the React 19 capability", () => {
    expect(noDefaultProps.defaultEnabled).not.toBe(false);
    expect(noDefaultProps.requires).toEqual(["react:19"]);
  });

  it("flags a defaultProps assignment on an arrow function component", () => {
    const result = runRule(
      noDefaultProps,
      `export const Link = (props) => <a {...props} />;
Link.defaultProps = { appearance: 'default', size: 'regular', disabled: false };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags a defaultProps assignment on a function declaration component", () => {
    const result = runRule(
      noDefaultProps,
      `function Dialog(props) { return <div role="dialog" {...props} />; }
Dialog.defaultProps = { dimension: 'small' };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent on a lowercase object with a defaultProps property", () => {
    const result = runRule(noDefaultProps, `config.defaultProps = { size: 'sm' };`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on computed access", () => {
    const result = runRule(noDefaultProps, `Link['defaultProps'] = { size: 'sm' };`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
