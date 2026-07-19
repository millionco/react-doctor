// rule: class-component-missing-component-will-unmount-teardown
// weakness: wrapper-transparency
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class Search extends React.Component {
  componentDidMount(): void {
    const autocomplete = (places as typeof places)({ container: this.input });
    autocomplete.on("change", this.onChange);
  }

  render(): React.ReactNode {
    return null;
  }
}

declare const places: (options: { container: unknown }) => {
  on: (eventName: string, handler: unknown) => void;
};
