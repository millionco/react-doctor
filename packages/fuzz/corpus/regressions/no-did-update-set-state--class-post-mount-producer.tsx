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
  layoutKind: LayoutKind;
  other: boolean;
}
export class MeasuredPanel extends React.Component<Props, State> {
  state: State = { layoutKind: "tall", other: false };
  hostRef = React.createRef<HTMLDivElement>();
  mediaRef = React.createRef<HTMLImageElement>();
  lastBounds: DOMRect | null = null;
  details() {
    return { caption: "layout" };
  }
  caption() {
    const record = this.details();
    const { caption: text } = record;
    return text;
  }
  readLayout(): LayoutKind {
    const host = this.hostRef.current;
    if (host === null) return "tall";
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    const naturalWidth = this.mediaRef.current?.naturalWidth || 0;
    return naturalWidth > bounds.width ? "wide" : "tall";
  }
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) {
      this.setState({ layoutKind: next });
    }
  }
  render() {
    return <div ref={this.hostRef}>{this.caption()}</div>;
  }
}
