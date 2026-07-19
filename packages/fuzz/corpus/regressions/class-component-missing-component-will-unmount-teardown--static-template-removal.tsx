// rule: class-component-missing-component-will-unmount-teardown
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class ScrollArea extends React.Component {
  noop = (): void => {};

  componentDidMount(): void {
    window.addEventListener(`resize`, this.noop);
    window.removeEventListener(`resize`, this.noop);
  }

  render(): React.ReactNode {
    return null;
  }
}
