import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const cases = [
  {
    name: "literal-span",
    code: "import { styled } from '@mui/material';\nconst Leaf = styled('span')`color:red;`;\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 0,
  },
  {
    name: "palette-only-span",
    code: "import { styled } from '@mui/material';\nconst Leaf = styled('span')`color: ${({ theme }) => theme.palette.primary.main};`;\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 0,
  },
  {
    name: "intrinsic-existing",
    code: "export function Demo({ rows }) { return rows.map((part,index)=><span key={index}>{part.value}</span>); }",
    expected: 0,
  },
  {
    name: "arbitrary-local-component",
    code: "const Leaf=({children})=><input defaultValue={children}/>;\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 1,
  },
  {
    name: "wrong-provider",
    code: "import {styled} from './opaque';const Leaf=styled('span')`color:red;`;\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 1,
  },
  {
    name: "scrollable-styled-span",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`display:block;max-height:2rem;overflow:auto;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "stateful-host",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('input')`color:red;`;\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 1,
  },
  {
    name: "polymorphic-as",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf as='input' key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "props-spread",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('span')`color:red;`;export function Demo({rows,extra}){return rows.map((part,index)=><Leaf {...extra} key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "event-prop",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('span')`color:red;`;export function Demo({rows,onClick}){return rows.map((part,index)=><Leaf onClick={onClick} key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "ref-prop",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('span')`color:red;`;export function Demo({rows,hostRef}){return rows.map((part,index)=><Leaf ref={hostRef} key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "attrs-or-config-chain",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('span').attrs({as:'input'})`color:red;`;\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 1,
  },
  {
    name: "component-property-write",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('span')`color:red;`;Leaf.defaultProps={as:'input'};\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 1,
  },
  {
    name: "factory-property-write",
    code: "import { styled } from '@mui/material';\nstyled.extra=()=>null;const Leaf=styled('span')`color:red;`;\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 1,
  },
  {
    name: "component-escape",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('span')`color:red;`;consume(Leaf);\nexport function Demo({ rows }) { return rows.map((part, index) => <Leaf key={index}>{part.value}</Leaf>); }",
    expected: 1,
  },
  {
    name: "stateful-descendant",
    code: "import { styled } from '@mui/material';\nconst Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}><input defaultValue={part.value}/></Leaf>);}",
    expected: 1,
  },
  {
    name: "shadowed-leaf",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){const Leaf=({children})=><input defaultValue={children}/>;return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "alias-then-default-props",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const Alias=Leaf;Alias.defaultProps={as:'input'};export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "interpolation-call",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`${({theme})=>consume(theme)}`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "call-child",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{render(part.value)}</Leaf>);}",
    expected: 1,
  },
  {
    name: "explicit-children-prop",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index} children={part.value}/>);}",
    expected: 1,
  },
  {
    name: "aliased-import",
    code: "import {styled as makeStyled} from '@mui/material';const Leaf=makeStyled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 0,
  },
  {
    name: "multiple-wrappers",
    code: "import {styled} from '@mui/material';const Added=styled('span')`color:red;`;const Removed=styled('span')`color:blue;`;export function Demo({rows}){return rows.map((part,index)=>part.added?<Added key={index}>{part.value}</Added>:<Removed key={index}>{part.value}</Removed>);}",
    expected: 0,
  },
  {
    name: "mutable-let",
    code: "import {styled} from '@mui/material';let Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "exported-wrapper",
    code: "import {styled} from '@mui/material';export const Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "component-prop",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf component='input' key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "factory-options",
    code: "import {styled} from '@mui/material';const Leaf=styled('span',{name:'Selectable'})`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "nested-same-wrapper",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}><Leaf>{part.value}</Leaf></Leaf>);}",
    expected: 1,
  },
  {
    name: "fragment-custom-child",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const Other=({value})=><input defaultValue={value}/>;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}><><Other value={part.value}/></></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "root-tab-index",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index} tabIndex={0}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "stored-element-type-default-props",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const e=<Leaf/>;e.type.defaultProps={as:'input'};export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "stored-map-elements",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const elements=rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);elements[0].type.defaultProps={as:'input'};",
    expected: 1,
  },
  {
    name: "array-element-transport",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const elements=[<Leaf/>];consume(elements);export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "call-argument-transport",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;consume(<Leaf/>);export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "three-branch-return",
    code: "import {styled} from '@mui/material';const Added=styled('span')`color:red;`;const Removed=styled('span')`color:blue;`;export const show=(rows)=>{return <span>{rows.map((part,index)=>part.added?<Added key={index}>{part.value}</Added>:part.removed?<Removed key={index}>{part.value}</Removed>:<span key={index}>{part.value}</span>)}</span>;};",
    expected: 0,
  },
  {
    name: "local-call-return-transport",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;function make(){return <Leaf/>;}const e=make();e.type.defaultProps={as:'input'};export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}",
    expected: 1,
  },
  {
    name: "direct-call-of-exported-function",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);}const elements=Demo({rows:[{value:'x'}]});elements[0].type.defaultProps={as:'input'};",
    expected: 1,
  },
  {
    name: "named-function-self-call",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export const Demo=function render({rows,mutate}){if(mutate){const elements=render({rows:[{value:'x'}],mutate:false});elements[0].type.defaultProps={as:'input'};return elements;}return rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>);};",
    expected: 1,
  },
  {
    name: "custom-parent-children-type-mutation",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;function Consumer({children}){children.type.defaultProps={as:'input'};return children;}export function Demo({rows}){return rows.map((part,index)=><Consumer><Leaf key={index}>{part.value}</Leaf></Consumer>);}",
    expected: 1,
  },
  {
    name: "native-parent-direct-return",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 0,
  },
  {
    name: "known-object-map",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const rows={map(fn){const element=fn({value:'x'},0);element.type.defaultProps={as:'input'};return [element];}};export function Demo(){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "aliased-known-object-map",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const source={map(fn){const element=fn({value:'x'},0);element.type.defaultProps={as:'input'};return [element];}};const rows=source;export function Demo(){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "native-array-map-override",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const rows=[{value:'x'}];rows.map=function(fn){const element=fn(this[0],0);element.type.defaultProps={as:'input'};return [element];};export function Demo(){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "alias-array-map-override",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const rows=[{value:'x'}];const alias=rows;alias.map=function(fn){const element=fn(this[0],0);element.type.defaultProps={as:'input'};return [element];};export function Demo(){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "object-assign-map-override",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const rows=[{value:'x'}];Object.assign(rows,{map(fn){const e=fn(this[0],0);e.type.defaultProps={as:'input'};return[e];}});export function Demo(){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "define-property-map-override",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const rows=[{value:'x'}];Object.defineProperty(rows,'map',{value(fn){const e=fn(this[0],0);e.type.defaultProps={as:'input'};return[e];}});export function Demo(){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "receiver-alias-call-escape",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const rows=[{value:'x'}];const alias=rows;consume(alias);export function Demo(){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "underscore-component-descendant",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const _Input=({value})=><input defaultValue={value}/>;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<_Input value={part.value}/></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "unicode-component-descendant",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;const ÄInput=({value})=><input defaultValue={value}/>;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<ÄInput value={part.value}/></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "custom-element-descendant",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<custom-input value={part.value}/></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "known-strong-text-descendant",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<strong>{/* text only */}{part.value}</strong></Leaf>)}</span>;}",
    expected: 0,
  },
  {
    name: "array-input-descendant",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}{[<input/>]}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "array-row-text-descendant",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}{['prefix',part.value]}</Leaf>)}</span>;}",
    expected: 0,
  },
  {
    name: "sequence-input-descendant",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}{[(0,<input/>)]}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "nested-spread-attribute",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<span {...part.props}/></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "nested-dangerous-html",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<span dangerouslySetInnerHTML={{__html:part.value}}/></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "nested-children-input",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<span children={<input defaultValue={part.value}/>}/></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "nested-children-row-text",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<span children={part.value}/></Leaf>)}</span>;}",
    expected: 0,
  },
  {
    name: "nested-ref-attribute",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows,nodeRef}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<span ref={nodeRef}/></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "nested-event-attribute",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows,handleClick}){return <span>{rows.map((part,index)=><Leaf key={index}>{part.value}<span onClick={handleClick}/></Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "editable-native-parent",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows}){return <div contentEditable>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</div>;}",
    expected: 1,
  },
  {
    name: "spread-native-parent",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows,hostProps}){return <span {...hostProps}>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 1,
  },
  {
    name: "dir-and-class-native-parent",
    code: "import {styled} from '@mui/material';const Leaf=styled('span')`color:red;`;export function Demo({rows,dir,className}){return <span dir={dir} className={className}>{rows.map((part,index)=><Leaf key={index}>{part.value}</Leaf>)}</span>;}",
    expected: 0,
  },
];

describe("direct MUI span text leaves", () => {
  for (const row of cases) {
    it(row.name, () => {
      const result = runRule(noArrayIndexAsKey, row.code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(row.expected);
    });
  }
});
