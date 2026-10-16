// rule: state-in-constructor
// verdict: pass
// weakness: typed-declaration
// source: independent synthetic regression
import * as React from "react";

interface StateShape {
  ready: boolean;
}

export class TypedStateDeclaration extends React.Component {
  state: StateShape;

  constructor(props: Record<string, unknown>) {
    super(props);
    this.state = { ready: false };
  }

  render() {
    return null;
  }
}
