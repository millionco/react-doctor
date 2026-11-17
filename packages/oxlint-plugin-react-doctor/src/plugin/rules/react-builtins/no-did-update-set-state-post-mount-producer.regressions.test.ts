import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDidUpdateSetState } from "./no-did-update-set-state.js";

const cases = [
  {
    name: "wrapped-arrow-dom-layout",
    expected: 0,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout = (): LayoutKind => {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "wrapped-method-dom-layout",
    expected: 0,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout(): LayoutKind {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  }
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "wrapped-arrow-callback-second-argument-and-static-field",
    expected: 0,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  static familyTag: string = 'generic-layout-widget';
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout = (): LayoutKind => {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }, () => { this.props.onMeasured?.(); }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "sibling-nonself-state-write",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout = (): LayoutKind => {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); this.setState({ other: !this.state.other }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "wrapped-arrow-native-focus-side-effect",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout = (): LayoutKind => {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    host.focus();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "overwritten-prototype-method",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout(): LayoutKind {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  }
  replaceReader = (): void => { this.readLayout = (): LayoutKind => 'wide'; };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} onClick={this.replaceReader} />; }
}`,
  },
  {
    name: "overwritten-arrow-member",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout = (): LayoutKind => {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  };
  replaceReader = (): void => { this.readLayout = (): LayoutKind => 'wide'; };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} onClick={this.replaceReader} />; }
}`,
  },
  {
    name: "cache-field-accessor-sets-state",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  storedBounds: DOMRect | null = null;
  get lastBounds(): DOMRect | null { return this.storedBounds; }
  set lastBounds(value: DOMRect | null) { this.storedBounds = value; this.setState({ other: true }); }
  readLayout = (): LayoutKind => {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "helper-fresh-object-after-dom-read",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: unknown; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout = (): { kind: LayoutKind } => {
    const host = this.hostRef.current;
    if (host === null) return { kind: 'tall' };
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return { kind: bounds.width > bounds.height ? 'wide' : 'tall' };
  };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "wrapped-async-promise-as-state",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: unknown; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout = async (): Promise<LayoutKind> => {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  };
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "wrapped-generator-iterator-as-state",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: unknown; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  *readLayout(): Generator<LayoutKind, LayoutKind, unknown> {
    yield 'wide';
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  }
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "optional-measurement-with-fallback",
    expected: 0,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  mediaRef = React.createRef<HTMLImageElement>();
  lastBounds: DOMRect | null = null;
  readLayout(): LayoutKind {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    const naturalWidth = this.mediaRef.current?.naturalWidth || 0;
    return naturalWidth > bounds.width ? 'wide' : 'tall';
  }
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "optional-measurement-call-is-unsupported",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout(): LayoutKind {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host?.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  }
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "known-ref-container-replacement",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout(): LayoutKind {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  }
  replaceRef() { this.hostRef = { current: document.createElement("div") }; }
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return null; }
}`,
  },
  {
    name: "known-destructured-mutator",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout(): LayoutKind {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  }
  replaceRef() { const { assign } = Object; assign(this.hostRef, { current: document.createElement("div") }); }
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return null; }
}`,
  },
  {
    name: "known-mutator-call-invocation",
    expected: 1,
    code: `import React from 'react';
type LayoutKind = 'wide' | 'tall';
interface Props { revision: number; onMeasured?(): void; }
interface State { layoutKind: LayoutKind; other: boolean; }
class LayoutWidget extends React.Component<Props, State> {
  state: State = { layoutKind: 'tall', other: false };
  hostRef = React.createRef<HTMLDivElement>();
  lastBounds: DOMRect | null = null;
  readLayout(): LayoutKind {
    const host = this.hostRef.current;
    if (host === null) return 'tall';
    const bounds = host.getBoundingClientRect();
    this.lastBounds = bounds;
    return bounds.width > bounds.height ? 'wide' : 'tall';
  }
  replaceRef() { Object.assign.call(Object, this.hostRef, { current: document.createElement("div") }); }
  componentDidUpdate(_previousProps: Props): void {
    const next = this.readLayout();
    if (next !== this.state.layoutKind) { this.setState({ layoutKind: next }); }
  }
  render() { return null; }
}`,
  },
  {
    name: "known-mutator-carrier-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    const box = { mutate: Object.assign };
    box.mutate(this.hostRef, { current: custom });
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "known-spread-mutator-carrier-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    const box = { ...{ mutate: Object.assign } };
    box.mutate(this.hostRef, { current: custom });
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "known-local-mutator-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    const replace = (ref: { current: unknown }) => { ref.current = custom; };
    replace(this.hostRef);
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "react-owned-state-is-not-measurement-cache",
    expected: 1,
    code: `import React from "react";
interface PanelState { layout?: string; width?: number; height?: number }
class MeasuredPanel extends React.Component<{}, PanelState> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state: PanelState = { layout: "" };
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.state = host.getBoundingClientRect();
    return "wide";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return <div ref={this.hostRef} />; }
}
`,
  },
  {
    name: "known-bound-local-mutator-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    const replace = (ref: { current: unknown }) => { ref.current = custom; };
    const bound = replace.bind(null);
    bound(this.hostRef);
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "known-reflect-apply-local-mutator-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    const replace = (ref: { current: unknown }) => { ref.current = custom; };
    Reflect.apply(replace, null, [this.hostRef]);
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "known-tagged-local-mutator-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    const tag = (_strings: TemplateStringsArray, ref: { current: unknown }) => { ref.current = custom; };
    tag\`x\${this.hostRef}\`;
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "known-constructor-mutator-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    class Replace { constructor(ref: { current: unknown }) { ref.current = custom; } }
    new Replace(this.hostRef);
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "known-conditional-sequence-mutator-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    const replace = (ref: { current: unknown }) => { ref.current = custom; };
    const selected = this.state.layout ? replace : (_ref: { current: unknown }) => {};
    (0, selected)(this.hostRef);
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "known-assignment-argument-ref-mutator-render-null",
    expected: 1,
    code: `import React from "react";
class MeasuredPanel extends React.Component<{}, { layout: string }> {
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  state = { layout: "" };
  replaceHost() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    let alias: { current: unknown } | null = null;
    Object.assign((alias = this.hostRef), { current: custom });
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return null; }
}
`,
  },
  {
    name: "unrelated-own-method-record-destructure-preserves-layout-proof",
    expected: 0,
    code: `import React from "react";
class LayoutCard extends React.Component<{}, { layout: string }> {
  state = { layout: "" };
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  details() { return { caption: "layout", rank: 1 }; }
  caption() {
    const record = this.details();
    const { caption: text } = record;
    return text;
  }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return <div ref={this.hostRef}>{this.caption()}</div>; }
}`,
  },
  {
    name: "factory-returned-callable-object-destructure-retains-protected-ref-warning",
    expected: 1,
    code: `import React from "react";
class LayoutCard extends React.Component<{}, { layout: string }> {
  state = { layout: "" };
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  tools() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 1 }) };
    const rewrite = (ref: { current: unknown }) => { ref.current = custom; };
    return { rewrite };
  }
  replaceHost() {
    const carrier = this.tools();
    const { rewrite: applyReplacement } = carrier;
    applyReplacement(this.hostRef);
  }
  componentDidMount() { this.replaceHost(); }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "destructuring-getter-object-receiver-cannot-replace-protected-ref",
    expected: 1,
    code: `import React from "react";
class LayoutCard extends React.Component<{}, { layout: string }> {
  state = { layout: "tall" };
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  tools() {
    const custom = { getBoundingClientRect: () => ({ width: Math.random(), height: 0.5 }) };
    return {
      ref: this.hostRef,
      get payload() {
        this.ref.current = custom;
        return 0;
      },
    };
  }
  replaceHost() {
    const carrier = this.tools();
    const { payload } = carrier;
  }
  componentDidMount() { this.replaceHost(); }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "tall";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "returned-protected-record-method-call-receiver-remains-unsafe",
    expected: 1,
    code: `import React from "react";
class LayoutCard extends React.Component<{}, { layout: string }> {
  state = { layout: "tall" };
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  tools = () => ({ ref: this.hostRef, rewrite: this.rewrite });
  rewrite() {
    this.ref.current = {
      getBoundingClientRect: () => ({ width: Math.random(), height: 0.5 }),
    };
  }
  replaceHost() {
    const carrier = this.tools();
    const { rewrite } = carrier;
    rewrite.call(carrier);
  }
  componentDidMount() { this.replaceHost(); }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "tall";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "block-returned-protected-record-call-receiver-remains-unsafe",
    expected: 1,
    code: `import React from "react";
class LayoutCard extends React.Component<{}, { layout: string }> {
  state = { layout: "tall" };
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  tools() { return { ref: this.hostRef, rewrite: this.rewrite }; }
  rewrite() {
    this.ref.current = {
      getBoundingClientRect: () => ({ width: Math.random(), height: 0.5 }),
    };
  }
  replaceHost() {
    const carrier = this.tools();
    const { rewrite } = carrier;
    rewrite.call(carrier);
  }
  componentDidMount() { this.replaceHost(); }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "tall";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "generator-yielded-protected-record-call-receiver-remains-unsafe",
    expected: 1,
    code: `import React from "react";
class LayoutCard extends React.Component<{}, { layout: string }> {
  state = { layout: "tall" };
  hostRef = React.createRef<HTMLDivElement>();
  bounds: DOMRect | null = null;
  *tools() { yield { ref: this.hostRef, rewrite: this.rewrite }; }
  rewrite() {
    this.ref.current = {
      getBoundingClientRect: () => ({ width: Math.random(), height: 0.5 }),
    };
  }
  replaceHost() {
    const carrier = this.tools().next().value;
    const { rewrite } = carrier;
    rewrite.call(carrier);
  }
  componentDidMount() { this.replaceHost(); }
  readLayout() {
    const host = this.hostRef.current;
    if (!host) return "tall";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() { return <div ref={this.hostRef} />; }
}`,
  },
  {
    name: "unrelated-record-destructure-with-exact-callback-ref-host",
    expected: 0,
    code: `import React from "react";
class LayoutCard extends React.Component<{}, { layout: string }> {
  state = { layout: "" };
  host: HTMLDivElement | null = null;
  bounds: DOMRect | null = null;
  details() { return { caption: "layout", rank: 1 }; }
  caption() {
    const record = this.details();
    const { caption: text } = record;
    return text;
  }
  readLayout() {
    const host = this.host;
    if (!host) return "";
    this.bounds = host.getBoundingClientRect();
    return this.bounds.width > this.bounds.height ? "wide" : "tall";
  }
  componentDidUpdate() {
    const next = this.readLayout();
    if (next !== this.state.layout) this.setState({ layout: next });
  }
  render() {
    return <div ref={(node) => (this.host = node)}>{this.caption()}</div>;
  }
}`,
  },
];

describe("same-class post-mount producers", () => {
  it.each(cases)("$name", ({ code, expected, name }) => {
    const result = runRule(noDidUpdateSetState, code, {
      filename: "class-layout.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
    if (name === "sibling-nonself-state-write") {
      const lines = code.split("\n");
      const writerIndex = lines.findIndex((line) => line.includes("other: !this.state.other"));
      expect(result.diagnostics[0]?.line).toBe(writerIndex + 1);
      expect(result.diagnostics[0]?.column).toBe(
        lines[writerIndex].indexOf("this.setState({ other:"),
      );
    }
  });
});
