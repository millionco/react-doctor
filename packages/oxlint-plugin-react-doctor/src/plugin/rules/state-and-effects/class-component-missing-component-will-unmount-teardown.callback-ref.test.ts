import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { classComponentMissingComponentWillUnmountTeardown } from "./class-component-missing-component-will-unmount-teardown.js";

const cases = [
  {
    name: "stable-direct-root-named-callback-ref",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "missing-unmount-release",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n \n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "wrong-handler-release",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',()=>{});}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "root-key-changes",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div key={this.props.version} ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "root-type-conditional",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return this.props.changed?<span ref={this.captureNode}/>:<div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "named-ref-binding-replaced",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.captureNode=()=>{};this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 45,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "host-storage-replaced",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){this.node=document.createElement('div');}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "two-hosts-share-ref-field",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <><div ref={this.captureNode}/><div ref={this.captureNode}/></>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "custom-component-is-not-native-host",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <Widget ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "arbitrary-spread-can-override-ref",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode} {...this.props.extra}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "exact-readonly-class-props-rest",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {label,...rest}=this.props;return <div ref={this.captureNode} {...rest}>{label}</div>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "own-defaultprops-ref-insertion",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n static defaultProps={ref:()=>{},key:1};\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {...rest}=this.props;return <div ref={this.captureNode} {...rest}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 7,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "manual-null-before-unmount-release",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.captureNode(null);this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-binding-reassigned",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.handleScroll=()=>{};this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "capture-options-mismatch",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll,true);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "fake-react-superclass",
    code: "const React={PureComponent:class {}};\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "callback-ref-escapes",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){consume(this.captureNode);this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 47,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "ref-callback-returned-cleanup-unsupported",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;return ()=>{this.node=null;};};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "direct-static-computed-pair",
    code: 'import * as React from \'react\';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this["node"]=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this["node"].addEventListener(\'scroll\',this.handleScroll,{passive:true});}\n componentWillUnmount(){this["node"].removeEventListener(\'scroll\',this.handleScroll);}\n render(){return <div ref={this["captureNode"]}/>;}\n}\n',
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "null-initialized-host",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node=null;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "parenthesized-native-root",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return (<div ref={this.captureNode}/>);}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "host-property-write-does-not-replace-pointer",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n scrollTo(){this.node.scrollTop=1;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "catch-computed-pointer-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){try{throw {}}catch({[(this.node=document.createElement(\"div\"),\"value\")]:ignored}){}}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "catch-default-callback-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){try{throw {}}catch({value=(this.captureNode=()=>{})}){}}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "destructured-handler-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){({handler:this.handleScroll}=replacement);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "destructured-pointer-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){({host:this.node}=replacement);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "array-destructured-pointer-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){[this.node]=replacement;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "dynamic-instance-property-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(name,value){this[name]=value;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "instance-alias-escape",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){const instance=this;consume(instance);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "host-value-alias-escape",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){const host=this.node;consume(host);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "delete-callback",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){delete this.captureNode;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "typed-direct-eval",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){(eval as any)(\"this.node=null\");}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "function-capability-alias",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){const compile=Function;compile(\"return 0\")();}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "reflection-instance-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){Object.defineProperty(this,\"node\",{value:null});}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "props-ref-injection",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){this.props.ref=()=>{};}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "nested-props-object-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){this.props.extra.ref=()=>{};}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "parameter-property-runtime-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n constructor(public token=(this.node=null)){super();}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "nested-global-computed-capability",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(method){window.self[method](\"this.node=null\");}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "throwing-cleanup-prelude",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){risky();this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "conditional-cleanup-path",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){if(this.props.release)this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "async-cleanup-after-suspension",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n async componentWillUnmount(){await wait();this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "custom-jsx-factory-pragma",
    code: "/** @jsx customFactory */\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 7,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "defaultprops-metadata-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {label,...rest}=this.props;return <div ref={this.captureNode} {...rest}>{label}</div>;}\n}\nPanel.defaultProps={ref:()=>{}};\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "prototype-render-replacement",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\nPanel.prototype.render=function(){return <span/>;};\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "rest-alias-escape",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {label,...rest}=this.props;consume(rest);return <div ref={this.captureNode} {...rest}>{label}</div>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "rest-object-mutation",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {label,...rest}=this.props;rest.ref=()=>{};return <div ref={this.captureNode} {...rest}>{label}</div>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "rest-missing-catch-runtime-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {label,...rest}=this.props;try{throw {}}catch({[(rest.ref=()=>{},\"x\")]:ignored}){}return <div ref={this.captureNode} {...rest}>{label}</div>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "callback-default-parameter",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value=null)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "duplicate-render-definition",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <span/>;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "indirect-superclass-preserves-existing-abstention",
    code: "import * as React from 'react';\nclass Base extends React.PureComponent {static defaultProps={ref:()=>{}};}\nexport class Panel extends Base {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {label,...rest}=this.props;return <div ref={this.captureNode} {...rest}>{label}</div>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "callback-destructured-argument",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=({value})=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "pointer-delete",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){delete this.node;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "pointer-update",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){this.node++;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-reassigned-runtime-catch",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){try{throw {}}catch({[(this.handleScroll=()=>{},\"x\")]:ignored}){}}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "reflection-namespace-alias",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){const reflection=Reflect;reflection.set(this,\"node\",null);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "nested-reflection-provider",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(){globalThis.Object.assign(this,{node:null});}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "global-namespace-object-escape",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n replace(method){const host=globalThis.window;host[method](\"this.node=null\");}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "root-is-custom-element",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div is='special-host' ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "root-rest-default-key-insertion",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n static defaultProps={key:\"changing\"};\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {label,...rest}=this.props;return <div ref={this.captureNode} {...rest}>{label}</div>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 7,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "root-rest-default-is-insertion",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n static defaultProps={is:\"special-host\"};\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){const {label,...rest}=this.props;return <div ref={this.captureNode} {...rest}>{label}</div>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 7,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "rest-ref-override",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode} {...external}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "nested-native-root-wrapper",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <section><div ref={this.captureNode}/></section>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "extra-named-ref-render-host",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n extra(){return <div ref={this.captureNode}/>;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "conditional-return-before-host",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){if(this.props.hidden)return null;return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cleanup-explicit-throw",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){throw new Error(\"stop\");this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cleanup-capture-property-mismatch",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll,{capture:true});}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "callback-returns-cleanup",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;return ()=>{this.node=null;};};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "callback-async",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=async(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("native class callback-ref listener teardown", () => {
  for (const candidate of cases) {
    it(candidate.name, () => {
      expect(
        runRule(
          classComponentMissingComponentWillUnmountTeardown,
          candidate.code,
          candidate.options,
        ),
      ).toEqual({ diagnostics: candidate.diagnostics, parseErrors: [] });
    });
  }
  it("does not reuse receiver proof across settings on the same parsed AST", () => {
    const candidate = cases[0];
    if (!candidate) throw new Error("Missing synthetic case");
    const parsed = parseFixture(candidate.code, candidate.options);
    expect(
      runRuleOnParsedFixture(
        classComponentMissingComponentWillUnmountTeardown,
        candidate.code,
        parsed,
        candidate.options,
      ).diagnostics,
    ).toEqual([]);
    const custom = runRuleOnParsedFixture(
      classComponentMissingComponentWillUnmountTeardown,
      candidate.code,
      parsed,
      { ...candidate.options, settings: { jsxPragma: "customFactory" } },
    );
    expect(custom).toEqual({
      diagnostics: [
        {
          column: 21,
          line: 6,
          message:
            "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    });
    expect(
      runRuleOnParsedFixture(
        classComponentMissingComponentWillUnmountTeardown,
        candidate.code,
        parsed,
        candidate.options,
      ).diagnostics,
    ).toEqual([]);
  });
});

const importedRecordSource =
  "import {positions} from './positions';\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n scrollTo(axis,value){this.node[positions[axis]]=value;}\n render(){return <div ref={this.captureNode}/>;}\n}\n";
const importedRecordProvider =
  'export enum Axis {Vertical="vertical",Horizontal="horizontal"}\nexport const positions={[Axis.Vertical]:"scrollTop",[Axis.Horizontal]:"scrollLeft"};\n';
const importedRecordWarning = [
  {
    column: 21,
    line: 7,
    message:
      "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
    nodeType: "CallExpression",
  },
];
const providerCases = [
  {
    name: "plain-literal-enum-record",
    provider:
      'export enum Axis {Vertical="vertical",Horizontal="horizontal"}\nexport const positions={[Axis.Vertical]:"scrollTop",[Axis.Horizontal]:"scrollLeft"};\n',
    quiet: true,
  },
  {
    name: "unsafe-native-method-record",
    provider:
      'export enum Axis {Vertical="vertical",Horizontal="horizontal"}\nexport const positions={[Axis.Vertical]:"removeEventListener",[Axis.Horizontal]:"scrollLeft"};\n',
    quiet: false,
  },
  {
    name: "mutable-record-binding",
    provider:
      'export enum Axis {Vertical="vertical",Horizontal="horizontal"}\nexport let positions={[Axis.Vertical]:"scrollTop",[Axis.Horizontal]:"scrollLeft"};\n',
    quiet: false,
  },
  {
    name: "record-accessor",
    provider: 'export const positions={get vertical(){return "scrollTop";}};',
    quiet: false,
  },
  {
    name: "spread-record",
    provider: 'export const positions={...external,vertical:"scrollTop"};',
    quiet: false,
  },
  {
    name: "provider-record-mutation",
    provider:
      'export enum Axis {Vertical="vertical",Horizontal="horizontal"}\nexport const positions={[Axis.Vertical]:"scrollTop",[Axis.Horizontal]:"scrollLeft"};\npositions.vertical="removeEventListener";',
    quiet: false,
  },
  {
    name: "provider-call-in-computed-key",
    provider: 'export const positions={[pick()]:"scrollTop"};',
    quiet: false,
  },
  {
    name: "provider-barrel",
    provider: 'export {positions} from "./actual";',
    quiet: false,
  },
  {
    name: "provider-unknown-value",
    provider: "export const positions={vertical:selected};",
    quiet: false,
  },
];

const withImportedRecordFixture = (
  inspect: (directory: string, filename: string) => void,
): void => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-native-ref-data-"));
  try {
    const filename = path.join(directory, "component.tsx");
    fs.writeFileSync(filename, importedRecordSource);
    inspect(directory, filename);
  } finally {
    resetFilesystemCaches();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const observeImportedRecord = (filename: string, settings?: Readonly<Record<string, unknown>>) => {
  resetFilesystemCaches();
  return runRule(classComponentMissingComponentWillUnmountTeardown, importedRecordSource, {
    filename,
    settings,
    includeLocations: true,
  });
};

describe("finite imported native scroll-property records", () => {
  for (const candidate of providerCases) {
    it(candidate.name, () =>
      withImportedRecordFixture((directory, filename) => {
        fs.writeFileSync(path.join(directory, "positions.ts"), candidate.provider);
        fs.writeFileSync(path.join(directory, "actual.ts"), importedRecordProvider);
        expect(observeImportedRecord(filename)).toEqual({
          diagnostics: candidate.quiet ? [] : importedRecordWarning,
          parseErrors: [],
        });
      }),
    );
  }
  it("observes provider edits, deletion, appearance, and settings changes for the same filename", () =>
    withImportedRecordFixture((directory, filename) => {
      const providerPath = path.join(directory, "positions.ts");
      expect(observeImportedRecord(filename).diagnostics).toEqual(importedRecordWarning);
      fs.writeFileSync(providerPath, importedRecordProvider);
      expect(observeImportedRecord(filename).diagnostics).toEqual([]);
      fs.writeFileSync(
        providerPath,
        importedRecordProvider.replace("scrollTop", "removeEventListener"),
      );
      expect(observeImportedRecord(filename).diagnostics).toEqual(importedRecordWarning);
      fs.unlinkSync(providerPath);
      expect(observeImportedRecord(filename).diagnostics).toEqual(importedRecordWarning);
      fs.writeFileSync(providerPath, importedRecordProvider);
      expect(observeImportedRecord(filename, { jsxPragma: "customFactory" }).diagnostics).toEqual(
        importedRecordWarning,
      );
      expect(observeImportedRecord(filename).diagnostics).toEqual([]);
    }));
  it("pins missing and closer resolution candidates and every execution probe", () =>
    withImportedRecordFixture((directory, filename) => {
      const providerPath = path.join(directory, "positions.tsx");
      const closerPath = path.join(directory, "positions.ts");
      fs.writeFileSync(providerPath, importedRecordProvider);
      resetFilesystemCaches();
      const execution = captureCrossFileProbes(() =>
        runRule(classComponentMissingComponentWillUnmountTeardown, importedRecordSource, {
          filename,
          includeLocations: true,
        }),
      );
      expect(execution.value.diagnostics).toEqual([]);
      const collected = collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: importedRecordSource,
        ruleIds: ["class-component-missing-component-will-unmount-teardown"],
      });
      expect(collected).not.toBeNull();
      for (const contentPath of execution.trace.contentPaths)
        expect(collected?.contentPaths.has(contentPath)).toBe(true);
      for (const existencePath of execution.trace.existencePaths)
        expect(collected?.existencePaths.has(existencePath)).toBe(true);
      expect(collected?.contentPaths.has(providerPath)).toBe(true);
      expect(collected?.existencePaths.has(closerPath)).toBe(true);
      fs.writeFileSync(
        closerPath,
        importedRecordProvider.replace("scrollTop", "removeEventListener"),
      );
      expect(observeImportedRecord(filename).diagnostics).toEqual(importedRecordWarning);
      fs.unlinkSync(closerPath);
      expect(observeImportedRecord(filename).diagnostics).toEqual([]);
    }));
  it("rejects record mutation hidden in an omitted catch binding reference", () =>
    withImportedRecordFixture((directory, filename) => {
      fs.writeFileSync(path.join(directory, "positions.ts"), importedRecordProvider);
      const code = importedRecordSource.replace(
        " scrollTo(axis,value)",
        ' corrupt(){try{throw {}}catch({[(positions.vertical="removeEventListener","x")]:ignored}){}}\n scrollTo(axis,value)',
      );
      resetFilesystemCaches();
      expect(
        runRule(classComponentMissingComponentWillUnmountTeardown, code, {
          filename,
          includeLocations: true,
        }),
      ).toEqual({ diagnostics: importedRecordWarning, parseErrors: [] });
    }));
});

const propsDefaultCases = [
  {
    name: "readonly-props-default",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "props-default-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){props.ref=()=>{};return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "props-default-value-escape",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){consume(props);return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "props-default-reassigned",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){props=replacement;return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "props-default-catch-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){try{throw {}}catch({[(props.ref=()=>{},\"x\")]:ignored}){}return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        column: 21,
        line: 6,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "props-default-shadowed-local-read",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){const read=(props)=>props.itemSize;return props.itemSize||read(other);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
];

describe("readonly class props parameter defaults", () => {
  for (const candidate of propsDefaultCases)
    it(candidate.name, () => {
      expect(
        runRule(
          classComponentMissingComponentWillUnmountTeardown,
          candidate.code,
          candidate.options,
        ),
      ).toEqual({ diagnostics: candidate.diagnostics, parseErrors: [] });
    });
});

describe("imported native property record binding boundaries", () => {
  it("accepts a renamed runtime named import", () =>
    withImportedRecordFixture((directory, filename) => {
      fs.writeFileSync(path.join(directory, "positions.ts"), importedRecordProvider);
      const code = importedRecordSource
        .replace("{positions}", "{positions as offsets}")
        .replace("this.node[positions[axis]]", "this.node[offsets[axis]]");
      resetFilesystemCaches();
      expect(
        runRule(classComponentMissingComponentWillUnmountTeardown, code, {
          filename,
          includeLocations: true,
        }),
      ).toEqual({ diagnostics: [], parseErrors: [] });
    }));
  for (const declaration of [
    "import type {positions}",
    "import positions",
    "import * as positions",
  ]) {
    it(`declines ${declaration}`, () =>
      withImportedRecordFixture((directory, filename) => {
        fs.writeFileSync(path.join(directory, "positions.ts"), importedRecordProvider);
        const code = importedRecordSource.replace("import {positions}", declaration);
        resetFilesystemCaches();
        expect(
          runRule(classComponentMissingComponentWillUnmountTeardown, code, {
            filename,
            includeLocations: true,
          }),
        ).toEqual({ diagnostics: importedRecordWarning, parseErrors: [] });
      }));
  }
});

const reactProviderAndCacheCases = [
  {
    name: "visible-react-createElement-provider-injects-changing-root-key",
    code: "import React from 'react';\nconst nativeCreateElement=React.createElement;\nReact.createElement=(tag,props,...children)=>nativeCreateElement(tag,{...props,key:Math.random()},...children);\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 8,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "readonly-native-react-provider",
    code: "import * as React from 'react';\nconst providerType=typeof React;\nconst nativeCreateElement=React.createElement;\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "react-provider-object-escape",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n expose(){consume(React);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 6,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "runtime-type-only-react-provider",
    code: "import type * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 6,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "fresh-disjoint-empty-cache",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "fresh-cache-reset-to-fresh-object",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n reset(){this.cache={};}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "cache-value-alias-escape",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n expose(){consume(this.cache);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cache-replaced-by-external",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n replace(){this.cache=external;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cache-initialized-from-external",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache=external;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cache-replaced-by-selected-dom-pointer",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n replace(){this.cache=this.node;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "nested-cache-unknown-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key][value]=replacement;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cache-pointer-destructuring-write",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n replace(){({cache:this.cache}=external);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cache-pointer-delete",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n replace(){delete this.cache;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cache-pointer-update",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n cache={};\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n write(key,value){this.cache[key]=value;}\n replace(){this.cache++;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("visible React provider and disjoint fresh cache boundaries", () => {
  for (const candidate of reactProviderAndCacheCases)
    it(candidate.name, () => {
      expect(
        runRule(
          classComponentMissingComponentWillUnmountTeardown,
          candidate.code,
          candidate.options,
        ),
      ).toEqual({ diagnostics: candidate.diagnostics, parseErrors: [] });
    });
});

const automaticJsxProviderCases = [
  {
    name: "react/jsx-runtime-namespace-readonly-provider",
    code: "import * as runtime from 'react/jsx-runtime';\nconst factory=runtime.jsx;const providerType=typeof runtime;\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "react/jsx-runtime-namespace-visible-write",
    code: "import * as runtime from 'react/jsx-runtime';\nruntime.jsx=(tag,props)=>({tag,props:{...props,key:Math.random()}});\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 8,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "react/jsx-runtime-default-readonly-provider",
    code: "import runtime from 'react/jsx-runtime';\nconst factory=runtime.jsx;const providerType=typeof runtime;\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "react/jsx-runtime-default-visible-write",
    code: "import runtime from 'react/jsx-runtime';\nruntime.jsx=(tag,props)=>({tag,props:{...props,key:Math.random()}});\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 8,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "react/jsx-dev-runtime-namespace-readonly-provider",
    code: "import * as runtime from 'react/jsx-dev-runtime';\nconst factory=runtime.jsxDEV;const providerType=typeof runtime;\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "react/jsx-dev-runtime-namespace-visible-write",
    code: "import * as runtime from 'react/jsx-dev-runtime';\nruntime.jsxDEV=(tag,props)=>({tag,props:{...props,key:Math.random()}});\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 8,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "react/jsx-dev-runtime-default-readonly-provider",
    code: "import runtime from 'react/jsx-dev-runtime';\nconst factory=runtime.jsxDEV;const providerType=typeof runtime;\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "react/jsx-dev-runtime-default-visible-write",
    code: "import runtime from 'react/jsx-dev-runtime';\nruntime.jsxDEV=(tag,props)=>({tag,props:{...props,key:Math.random()}});\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 8,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "jsx-runtime-namespace-escape",
    code: "import * as runtime from 'react/jsx-runtime';\nconsume(runtime);\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 8,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("visible automatic JSX runtime providers", () => {
  for (const candidate of automaticJsxProviderCases)
    it(candidate.name, () => {
      expect(
        runRule(
          classComponentMissingComponentWillUnmountTeardown,
          candidate.code,
          candidate.options,
        ),
      ).toEqual({ diagnostics: candidate.diagnostics, parseErrors: [] });
    });
});

const propsTerminalAndShorthandCases = [
  {
    name: "props-default-nested-mutation",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){props.foo.bar=value;return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 6,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "props-default-nested-method-call",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){props.foo.method();return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 6,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "props-default-readonly-nested-read",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){return props.foo.bar;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "props-default-nested-delete",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){delete props.foo.bar;return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 6,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "props-default-nested-update",
    code: "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n estimate(props=this.props){props.foo.bar++;return props.itemSize;}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 6,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "react-provider-runtime-shorthand-escape",
    code: "import * as React from 'react';\nconsume({React});\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "automatic-provider-runtime-shorthand-escape",
    code: "import * as runtime from 'react/jsx-runtime';\nconsume({runtime});\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 8,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "nonreference-react-property-key",
    code: "import * as React from 'react';\nconst labels={React:'label'};\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
];

describe("readonly props terminal and shorthand provider boundaries", () => {
  for (const candidate of propsTerminalAndShorthandCases)
    it(candidate.name, () => {
      expect(
        runRule(
          classComponentMissingComponentWillUnmountTeardown,
          candidate.code,
          candidate.options,
        ),
      ).toEqual({ diagnostics: candidate.diagnostics, parseErrors: [] });
    });
});

const globalClassicProviderCases = [
  {
    name: "readonly-global-classic-react-provider",
    code: "import {PureComponent} from 'react';\nconst factory=React.createElement;const providerType=typeof React;\nexport class Panel extends PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [],
  },
  {
    name: "globalthis-react-provider-replaced",
    code: "import {PureComponent} from 'react';\nconst factory=React.createElement;globalThis.React={createElement:(tag,props)=>factory(tag,{...props,key:Math.random()})};\nexport class Panel extends PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "unbound-global-react-provider-replaced",
    code: "import {PureComponent} from 'react';\nconst factory=React.createElement;React={createElement:(tag,props)=>factory(tag,{...props,key:Math.random()})};\nexport class Panel extends PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
    options: {
      filename: "synthetic-stable-class-ref.tsx",
      includeLocations: true,
    },
    diagnostics: [
      {
        line: 7,
        column: 21,
        message:
          "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("visible global classic JSX provider boundaries", () => {
  for (const candidate of globalClassicProviderCases)
    it(candidate.name, () => {
      expect(
        runRule(
          classComponentMissingComponentWillUnmountTeardown,
          candidate.code,
          candidate.options,
        ),
      ).toEqual({ diagnostics: candidate.diagnostics, parseErrors: [] });
    });
});

describe("erased-only React provider companion", () => {
  it("nominal", () => {
    expect(
      runRule(
        classComponentMissingComponentWillUnmountTeardown,
        "import * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("erased-react", () => {
    expect(
      runRule(
        classComponentMissingComponentWillUnmountTeardown,
        "interface React { note: string };\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("nested-type", () => {
    expect(
      runRule(
        classComponentMissingComponentWillUnmountTeardown,
        "type Notes = ({nested:{constructor}}:{nested:{constructor:string}})=>void;\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("runtime-param", () => {
    expect(
      runRule(
        classComponentMissingComponentWillUnmountTeardown,
        "class Overrides { constructor(public ignored = Function(\"Object.prototype.addEventListener = function(){}\")()){} };new Overrides();\nimport * as React from 'react';\nexport class Panel extends React.PureComponent {\n node;\n captureNode=(value)=>{this.node=value;};\n handleScroll=()=>{this.setState({seen:true});};\n componentDidMount(){this.node.addEventListener('scroll',this.handleScroll,{passive:true});}\n componentWillUnmount(){this.node.removeEventListener('scroll',this.handleScroll);}\n render(){return <div ref={this.captureNode}/>;}\n}\n",
      ).diagnostics,
    ).toHaveLength(1);
  });
});
