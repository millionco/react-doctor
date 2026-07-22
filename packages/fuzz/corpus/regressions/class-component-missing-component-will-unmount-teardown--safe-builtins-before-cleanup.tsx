// rule: class-component-missing-component-will-unmount-teardown
// verdict: pass
// weakness: control-flow
// source: https://github.com/millionco/react-doctor/pull/1422

import React from "react";

const startedAt = performance.now();

export class Listener extends React.Component {
  componentDidMount(): void {
    emitter.on("change", this.handleChange);
  }

  componentWillUnmount(): void {
    console.info(Math.round(performance.now() - startedAt));
    emitter.off("change", this.handleChange);
  }

  render(): React.ReactNode {
    return null;
  }
}
