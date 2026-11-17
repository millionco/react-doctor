// rule: no-did-update-set-state
// weakness: class-post-mount-producer
// source: authored regression control

import React from "react";
type LayoutKind = "wide" | "tall";
interface Props {
  revision: number;
  onMeasured?(): void;
}
interface State {
  layoutKind: unknown;
  other: boolean;
}
export class MeasuredPanel extends React.Component<Props, State> {
  state: State = { layoutKind: "tall", other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout = (): { kind: LayoutKind } => {
    const host = this.hostRef.current;
    if (host === null) return { kind: "tall" };
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return { kind: bounds.width > bounds.height ? "wide" : "tall" };
  };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) {
      this.setState({ layoutKind: next });
    }
  }
  render() {
    return <div ref={this.hostRef} />;
  }
}
