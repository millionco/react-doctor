import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDidUpdateSetState } from "./no-did-update-set-state.js";

interface EarlyReturnCase {
  name: string;
  code: string;
  expected: number;
  settings?: Readonly<Record<string, unknown>>;
}
const cases: EarlyReturnCase[] = [
  {
    name: "direct equal return",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 0,
  },
  {
    name: "single block return",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) { return; }  this.setState({ ready: true }); } }',
    expected: 0,
  },
  {
    name: "reversed operands",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (previousProps.items === this.props.items) return;  this.setState({ ready: true }); } }',
    expected: 0,
  },
  {
    name: "unrelated own field write",
    code: 'import { Component } from "react"; class View extends Component { update() { this.selected = true; } componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 0,
  },
  {
    name: "prefix callback",
    code: 'import { Component } from "react"; class View extends Component { update(props) { this.selected = props.items; } componentDidUpdate(previousProps) { this.update(previousProps); if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 0,
  },
  {
    name: "pure component",
    code: 'import { PureComponent as Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 0,
  },
  {
    name: "difference",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items !== previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "coercive",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items == previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "wrong field",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.other) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "state",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.state.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "return value",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return work();  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "conditional return",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) { if (stop) return; }  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "block side effect",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) { work(); return; }  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "alternate",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return; else work();  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "try finally break",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  label: { if (this.props.items === previousProps.items) { try { return; } finally { break label; } } }  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "do while break",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) { do { if (stop) break; return; } while (false); }  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "current alias",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) { const current = this.props; if (current.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "previous alias",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) { const previous = previousProps; if (this.props.items === previous.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "intervening call",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return; work(); this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "different argument",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps, previousState) {  if (this.props.items === previousState.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "default parameter",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps = other) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "parameter replacement",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) { previousProps=other; if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "pattern replacement",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) { ({previous:previousProps}=other); if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "previous member write",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) { previousProps.items=other; if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "current props replacement",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) { this.props=other; if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "current field write",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) { this.props.items=other; if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "this alias",
    code: 'import { Component } from "react"; class View extends Component {  componentDidUpdate(previousProps) { const instance=this; if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "own props",
    code: 'import { Component } from "react"; class View extends Component { props={}; componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "own setter",
    code: 'import { Component } from "react"; class View extends Component { setState(value) { work(value); } componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "setter replacement",
    code: 'import { Component } from "react"; class View extends Component { replace(){this.setState=replacement;} componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "lifecycle replacement",
    code: 'import { Component } from "react"; class View extends Component { replace(){this.componentDidUpdate=replacement;} componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "computed replacement",
    code: 'import { Component } from "react"; class View extends Component { replace(key){this[key]=replacement;} componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "foreign",
    code: 'import {Component} from "foreign"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "type only",
    code: 'import type {Component} from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "local",
    code: "const Component=factory(); class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }",
    expected: 1,
  },
  {
    name: "mutable provider",
    code: 'import {Component} from "react"; Component=replacement; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "escaped provider",
    code: 'import {Component} from "react"; replace(Component); class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "provider prototype",
    code: 'import {Component} from "react"; Component.prototype.setState=replacement; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "default replacement",
    code: 'import React,{Component} from "react"; React.Component=replacement; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "unbound namespace",
    code: 'import React from "react"; class View extends Component {  componentDidUpdate(previousProps) {  if (this.props.items === previousProps.items) return;  this.setState({ ready: true }); } }',
    expected: 1,
  },
  {
    name: "nested callback default",
    code: 'import {Component} from "react";class View extends Component {componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;queue(()=>this.setState({ready:true}));}}',
    expected: 0,
  },
  {
    name: "try body unsupported",
    code: 'import {Component} from "react";class View extends Component{componentDidUpdate(previousProps){try{if(this.props.items===previousProps.items)return;this.setState({ready:true});}finally{work();}}}',
    expected: 1,
  },
  {
    name: "sibling default provider prototype replacement",
    code: 'import React,{Component} from "react";React.Component.prototype.setState=replacement;class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "class prototype replacement",
    code: 'import React,{Component} from "react";function replace(){View.prototype.setState=replacement;}class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "class props prototype accessor replacement",
    code: 'import React,{Component} from "react";function replace(){View.prototype.props=replacement;}class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "duplicate lifecycle method",
    code: 'import React,{Component} from "react";class View extends Component{componentDidUpdate(){this.setState({count:1});}componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 2,
  },
  {
    name: "async lifecycle",
    code: 'import React,{Component} from "react";class View extends Component{async componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "generator lifecycle",
    code: 'import React,{Component} from "react";class View extends Component{*componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "nested callback strict option",
    code: 'import React,{Component} from "react";class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;queue(()=>this.setState({ready:true}));}}',
    expected: 1,
    settings: { "react-doctor": { noDidUpdateSetState: { mode: "disallow-in-func" } } },
  },
  {
    name: "provider metadata conservative",
    code: 'import React,{Component} from "react";Component.name;class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "provider sibling namespace alias",
    code: 'import React,{Component} from "react";const native=React; native.Component.prototype.setState=replacement;class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "class prototype metadata API",
    code: 'import {Component} from "react";Object.defineProperty(View.prototype,"setState",{value:replacement});class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "class readonly alias member escape",
    code: 'import {Component} from "react";const Alias=View; replace(Alias.prototype);class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "sibling named provider",
    code: 'import {Component} from "react";import {Component as OtherComponent} from "react";OtherComponent.prototype.setState=replacement;class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "unknown class field",
    code: 'import {Component} from "react";class View extends Component{[methodName]=replacement;componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "props accessor",
    code: 'import {Component} from "react";class View extends Component{get props(){return read();}componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "typed class with unrelated native ref and functional writer",
    code: 'import React,{Component} from "react"; interface Input {items:unknown[];} interface State {count:number;} class View extends Component<Input,State>{control:React.RefObject<HTMLDivElement>;constructor(props:Input){super(props);this.control=React.createRef();}componentDidUpdate(previousProps:Input){this.prepare(previousProps);if(this.props.items===previousProps.items)return;this.setState(state=>({count:state.count+1}));}prepare(props:Input){this.selected=props.items;}}',
    expected: 0,
  },
  {
    name: "assignment this alias",
    code: 'import {Component} from "react";class View extends Component{componentDidUpdate(previousProps){let owner;owner=this;owner.props=other;if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "array this escape",
    code: 'import {Component} from "react";class View extends Component{componentDidUpdate(previousProps){replace([this]);if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "opaque this argument",
    code: 'import {Component} from "react";class View extends Component{componentDidUpdate(previousProps){replace(this);if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "native method bind retains liveness",
    code: 'import {Component} from "react";class View extends Component{constructor(props){super(props);this.update=this.update.bind(this);}update(){}componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 0,
  },
  {
    name: "opaque callback bind receiver unsupported",
    code: 'import {Component} from "react";class View extends Component{componentDidUpdate(previousProps){work.bind(this)();if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "direct eval binding write",
    code: 'import {Component} from "react";class View extends Component{componentDidUpdate(previousProps){eval("previousProps={items:[]}");if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "canonical dynamic function exposure",
    code: 'import {Component} from "react";class View extends Component{componentDidUpdate(previousProps){globalThis.Function("return 1")();if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "mutable class alias provider replacement",
    code: 'import {Component} from "react";class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}let Alias=View;Alias.prototype.setState=replacement;',
    expected: 1,
  },
  {
    name: "hybrid canonical React require provider replacement",
    code: 'import {Component} from "react";require("react").Component.prototype.setState=replacement;class View extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}}',
    expected: 1,
  },
  {
    name: "anonymous class assigned const with prototype replacement",
    code: 'import {Component} from "react";const View=class extends Component{componentDidUpdate(previousProps){if(this.props.items===previousProps.items)return;this.setState({ready:true});}};View.prototype.setState=replacement;',
    expected: 1,
  },
];

describe("previous props equality early return", () => {
  for (const { name, code, expected, settings } of cases) {
    it(name, () => {
      const result = runRule(noDidUpdateSetState, code, { settings });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    });
  }
});
