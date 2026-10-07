import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noThisInSfc } from "./no-this-in-sfc.js";

describe("legacy class instance this", () => {
  it.each([`import React from 'react';`, `const React = require('react-native');`])(
    "accepts lexical this in a mapped legacy-class render",
    (setup) => {
      const result = runRule(
        noThisInSfc,
        `
      ${setup}
      const List = React.createClass({
        render() {
          let Rows;
          Rows = this.props.items.map(item => <Row onClick={this.open} />);
          return <div>{Rows}</div>;
        }
      });
    `,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it("retains the report in an ordinary function component", () => {
    const result = runRule(
      noThisInSfc,
      `
      const List = ({ items }) => {
        let Rows;
        Rows = items.map(item => <Row onClick={this.open} />);
        return <div>{Rows}</div>;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
