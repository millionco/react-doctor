// rule: class-component-missing-component-will-unmount-teardown
// weakness: scope-shadowing
// source: PR #1365 deep audit
import React from "react";
import { runInAction } from "mobx";

void runInAction;

export class Preview extends React.Component {
  componentDidMount() {
    const runInAction = (callback: () => void) => callback();
    setTimeout(() => runInAction(() => console.log("ready")), 100);
  }

  render() {
    return null;
  }
}
