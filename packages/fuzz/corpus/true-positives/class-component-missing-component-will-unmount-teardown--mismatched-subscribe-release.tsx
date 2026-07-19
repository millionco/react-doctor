// rule: class-component-missing-component-will-unmount-teardown
// weakness: listener-release-signature
// source: Cursor Bugbot review of PR #1365
import { disposeOnUnmount } from "mobx-react";
import React from "react";

export class StoreSubscriber extends React.Component {
  componentDidMount() {
    this.store.subscribe(this.handleChange);
    disposeOnUnmount(this, () => this.store.unsubscribe("data", this.handleChange));
  }
  handleChange = () => {};
  render() {
    return null;
  }
}
