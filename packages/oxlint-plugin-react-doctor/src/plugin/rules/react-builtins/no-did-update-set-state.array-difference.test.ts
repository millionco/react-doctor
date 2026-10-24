import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDidUpdateSetState } from "./no-did-update-set-state.js";

describe("local array difference guards", () => {
  it("ordinary-matching-destructure", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("ordinary-direct-current-member", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){if(differs(previous.items,this.props.items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("ordinary-renamed-current-binding", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items:currentItems}=this.props;if(differs(previous.items,currentItems)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("ordinary-reversed-arguments", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(items,previous.items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("different-current-property", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){if(differs(previous.items,this.props.other)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("both-current-operands", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(items,this.props.items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("state-instead-of-current-prop", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){if(differs(previous.items,this.state.items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("equal-branch-polarity", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(!differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("or-bypass", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)||this.props.force){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("wrong-index-mapping", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index+1]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("wrong-element-identity", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is({},current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("nonreflexive-nan-inequality", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>value!==current[index]);\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("constant-predicate", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=()=>true;\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("async-predicate", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=async(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("nonempty-allocating-defaults", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[{}],current=[{}])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("selected-prop-default-producer", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items=readItems()}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("mutable-current-destructure", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){let{items}=this.props;items=readItems();if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("reassigned-helper", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nlet differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\ndiffers=()=>true;\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("implicit-arguments", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nfunction differs(previous=[],current=[]){return previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index])||arguments[0].force);}\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("call-transport", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs.call(null,previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("object-is-shadow", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst Object={is:()=>false};\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("object-is-visible-write", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nObject.is=()=>false;\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("array-some-visible-write", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nArray.prototype.some=()=>true;\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("native-own-some", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\nconst values=[];values.some=()=>true;const view=<Counter items={values}/>;\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("native-index-getter", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\nconst values=[];Object.defineProperty(values,0,{get:()=>({})});const view=<Counter items={values}/>;\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("object-index-getter", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\nconst values={length:1,get 0(){return{};},some(callback){return callback(this[0],0);}};const view=<Counter items={values}/>;\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("eval-visible-mutation", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\neval("Object.is=()=>false");\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component {state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("shadowed-previous-parameter", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";\nconst differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));\nclass Counter extends Component{componentDidUpdate(previous){const{items}=this.props;{const previous={items:[]};if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}}render(){return null;}}\n',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("function declaration with empty array defaults", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";function differs(previous=[],current=[]){return previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));}class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("direct constant function expression", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=function(previous=[],current=[]){return previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));};class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("negated difference else branch", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(!differs(previous.items,items)){}else{this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("conditional false branch", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;!differs(previous.items,items)?null:this.setState({tick:this.state.tick+1});}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("required conjunction", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(this.props.active&&differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("unrelated sibling default", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items,label=readLabel()}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("typed function declaration", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";function differs(previous:unknown[]=[],current:unknown[]=[]){return previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));}class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("generator comparator", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";function* differs(previous=[],current=[]){return previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));}class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("equality callback", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("bound comparator initializer", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const compare=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));const differs=compare.bind(null);class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("helper alias", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const compare=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));const differs=compare;class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("destructuring helper rebind", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";function differs(previous=[],current=[]){return previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));}({differs}={differs:()=>true});class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("exported helper", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";export function differs(previous=[],current=[]){return previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));}class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("escaping helper", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));consume(differs);class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("extra some argument", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]),touch());class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("extra Object is argument", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index],touch()));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("own some data property", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}const values={length:1,some:()=>true};const view=<Counter items={values}/>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("own some method", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}const values={length:1,some(){return true;}};const view=<Counter items={values}/>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("previous props field write", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;previous.items=[];if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("current props field write", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;this.props.items=this.props.items.concat(1);if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("props alias field write", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;const props=this.props;props.items=[];if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("visible array mutation", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;items.push({});if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("Object alias write", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}const native=Object;native.is=()=>false;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("global carrier write", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}globalThis.Object.is=()=>false;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("computed Object write", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}Object["is"]=()=>false;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("unrelated computed read refuses finite profile", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}const value=record[key];',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("previous parameter rebound", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){const{items}=this.props;previous=readProps();if(differs(previous.items,items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("whole props comparator unsupported", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{state={tick:0};componentDidUpdate(previous){if(differs(previous,this.props)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("nested inner guard default", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{componentDidUpdate(previous){const callback=()=>{if(differs(previous.items,this.props.items)){this.setState({tick:this.state.tick+1});}};}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("nested inner guard strict", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{componentDidUpdate(previous){const callback=()=>{if(differs(previous.items,this.props.items)){this.setState({tick:this.state.tick+1});}};}render(){return null;}}',
      { settings: { "react-doctor": { noDidUpdateSetState: { mode: "disallow-in-func" } } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("nested outer guard default", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{componentDidUpdate(previous){if(differs(previous.items,this.props.items)){const callback=()=>{this.setState({tick:this.state.tick+1});};}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("nested outer guard strict", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{componentDidUpdate(previous){if(differs(previous.items,this.props.items)){const callback=()=>{this.setState({tick:this.state.tick+1});};}}render(){return null;}}',
      { settings: { "react-doctor": { noDidUpdateSetState: { mode: "disallow-in-func" } } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("constructor own some assignment", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{componentDidUpdate(previous){if(differs(previous.items,this.props.items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}class Values{constructor(){this.length=1;this.some=()=>true;}}const view=<Counter items={new Values()}/>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("visible native code loader", () => {
    const result = runRule(
      noDidUpdateSetState,
      'import {Component} from "react";import {runInThisContext} from "node:vm";runInThisContext("Object.is=()=>false");const differs=(previous=[],current=[])=>previous.length!==current.length||previous.some((value,index)=>!Object.is(value,current[index]));class Counter extends Component{componentDidUpdate(previous){if(differs(previous.items,this.props.items)){this.setState({tick:this.state.tick+1});}}render(){return null;}}',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
