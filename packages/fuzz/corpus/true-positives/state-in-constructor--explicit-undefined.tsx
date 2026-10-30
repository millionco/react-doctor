// rule: state-in-constructor
// verdict: fail
// weakness: explicit-initializer
// source: independent synthetic control
import * as React from "react";

export class ExplicitStateInitializer extends React.Component {
  state: undefined = undefined;

  render() {
    return null;
  }
}
