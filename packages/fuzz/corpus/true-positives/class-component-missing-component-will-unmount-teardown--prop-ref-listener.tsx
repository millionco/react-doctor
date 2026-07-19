// rule: class-component-missing-component-will-unmount-teardown
// weakness: ref-owner-provenance
// source: Cursor Bugbot review of PR #1365

import React from "react";

interface PropRefListenerProps {
  containerRef: React.RefObject<EventTarget>;
}

export class PropRefListener extends React.Component<PropRefListenerProps> {
  componentDidMount() {
    this.props.containerRef.current?.addEventListener("change", this.handleChange);
  }

  handleChange = () => {};

  render() {
    return null;
  }
}
