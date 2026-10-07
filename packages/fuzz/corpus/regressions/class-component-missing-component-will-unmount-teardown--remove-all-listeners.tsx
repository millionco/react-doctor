// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: react-doctor 0.8.1-to-main all-rules parity, hackjutsu/Lepton
// verdict: pass

import React from "react";

declare const ipcRenderer: {
  on(eventName: string, listener: () => void): void;
  removeAllListeners(eventName: string): void;
};

export class GistEditor extends React.Component {
  componentDidMount(): void {
    ipcRenderer.on("submit-gist", () => this.submit());
  }

  componentWillUnmount(): void {
    ipcRenderer.removeAllListeners("submit-gist");
  }

  submit = (): void => {};

  render(): React.ReactNode {
    return null;
  }
}
