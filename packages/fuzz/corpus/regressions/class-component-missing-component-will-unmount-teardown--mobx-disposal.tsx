// rule: class-component-missing-component-will-unmount-teardown
// weakness: proven-mobx-disposal
// source: Cursor Bugbot review of PR #1365
import { disposeOnUnmount as dispose } from "mobx-react";
import React from "react";

export class Viewport extends React.Component {
  componentDidMount() {
    window.addEventListener("resize", this.handleResize);
    dispose(this, () => window.removeEventListener("resize", this.handleResize));
  }
  handleResize = () => {};
  render() {
    return null;
  }
}

export class StoreSubscriber extends React.Component {
  componentDidMount() {
    this.store.subscribe(this.handleChange);
    dispose(this, () => this.store.unsubscribe(this.handleChange));
  }
  handleChange = () => {};
  render() {
    return null;
  }
}

export class OneShotSubscriber extends React.Component {
  componentDidMount() {
    this.bus.once("data", this.handleData);
    dispose(this, () => this.bus.off("data", this.handleData));
  }
  handleData = () => {};
  render() {
    return null;
  }
}
