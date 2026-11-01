import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noRandomKey } from "./no-random-key.js";

interface LocalResourceKeyCase {
  name: string;
  code: string;
  expectedCount: number;
}

const commonOptions: RunRuleOptions = {
  filename: "independent-resource-key.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react"],
    },
  },
};

const cases: LocalResourceKeyCase[] = [
  {
    name: "component-local-array-object-key",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 1,
  },
  {
    name: "push-built-leaf-array",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => { const cards = []; for (const label of ["Ready"]) { cards.push({token: makeKey(), label}); } return cards; };\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 1,
  },
  {
    name: "readonly-dispatcher-two-leaf-returns",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeFirst = () => [{token: makeKey(), label:"A"}]; const makeSecond = () => [{token:makeKey(),label:"B"}]; const makeCards = (first) => { if(first) { const cards = makeFirst(); return cards; } const cards = makeSecond(); return cards; };\nconst Cards = () => { const cards = makeCards(true); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 1,
  },
  {
    name: "canonical-grid-render-cell",
    code: 'import { v4 as makeKey } from "uuid";\nimport { DataGrid } from "@mui/x-data-grid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nexport const Example = () => { const columns = [{ field: "label", renderCell: () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; } }]; return <DataGrid columns={columns} rows={[]} />; };\n',
    expectedCount: 1,
  },
  {
    name: "canonical-grid-source-last-column-copy",
    code: 'import { v4 as makeKey } from "uuid";\nimport { DataGrid } from "@mui/x-data-grid";\nconst makeCards = () => { const cards = []; for (const label of ["Ready"]) { cards.push({ token: makeKey(), label }); } return cards; };\nexport const Example = () => { const baseColumn = { width: 120 }; const columns = [{ field: "label", renderCell: () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; } }].map((column) => ({...baseColumn, ...column})); return <DataGrid columns={[{field:"prefix"}, ...columns]} rows={[]} />; };\n',
    expectedCount: 1,
  },
  {
    name: "canonical-import-local-alias",
    code: 'import { v4 as createToken } from "uuid";\nconst makeCards = () => [{ token: createToken(), label: "Ready" }];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 1,
  },
  {
    name: "alternate-static-own-key-property",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ identity: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.identity}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 1,
  },
  {
    name: "transparent-typescript-data-wrapper",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => ([{token:makeKey(),label:"Ready"}] satisfies {token:string;label:string}[]);\nconst Cards = () => { const cards = (makeCards() as {token:string;label:string}[]); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 1,
  },
  {
    name: "persistent-module-item-creation",
    code: 'import { v4 as makeKey } from "uuid";\nconst cards = [{token:makeKey(),label:"Ready"}];\nconst Cards = () => {  return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "event-created-items-retained-in-state",
    code: 'import { v4 as makeKey } from "uuid";\nimport {useState} from "react";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nexport const Example = () => { const [cards,setCards] = useState([]); return <><button onClick={()=>setCards(makeCards())}>Add</button><section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section></>; };\n',
    expectedCount: 0,
  },
  {
    name: "memoized-list-result",
    code: 'import { v4 as makeKey } from "uuid";\nimport {useMemo} from "react";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards = useMemo(() => makeCards(), []); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "captured-once-generated-property",
    code: 'import { v4 as makeKey } from "uuid";\nconst token = makeKey(); const makeCards = () => [{token,label:"Ready"}];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "unknown-imported-resource-provider",
    code: 'import { makeCards } from "some-card-provider";\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "stable-item-property",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{token:"stable",label:"Ready"}];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "same-spelled-local-id-provider",
    code: 'const makeKey=()=>"stable";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "mutable-factory-binding",
    code: 'import { v4 as makeKey } from "uuid";\nlet makeCards = () => [{token:makeKey(),label:"Ready"}]; makeCards = () => [{token:"stable",label:"Ready"}];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "selected-result-property-write",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards = makeCards(); cards[0].token = "stable"; return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "selected-result-array-transport",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards = makeCards(); inspect(cards); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "map-item-key-overwrite",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => { card.token="stable"; return <span key={card.token}>{card.label}</span>; })}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "object-spread-overwrites-fresh-property",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{token:makeKey(),...{token:"stable"},label:"Ready"}];\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "factory-returns-cached-array",
    code: 'import { v4 as makeKey } from "uuid";\nconst cachedCards = [{token:makeKey(),label:"Ready"}]; const makeCards = () => cachedCards;\nconst Cards = () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "foreign-grid-lookalike",
    code: 'import { v4 as makeKey } from "uuid";\nimport { DataGrid } from "other-grid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nexport const Example = () => { const columns = [{ field: "label", renderCell: () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; } }]; return <DataGrid columns={columns} rows={[]} />; };\n',
    expectedCount: 0,
  },
  {
    name: "later-jsx-columns-override",
    code: 'import { v4 as makeKey } from "uuid";\nimport { DataGrid } from "@mui/x-data-grid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nexport const Example = () => { const columns = [{ field: "label", renderCell: () => { const cards = makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; } }]; return <DataGrid columns={columns} {...overrides} rows={[]} />; };\n',
    expectedCount: 0,
  },
  {
    name: "later-column-renderer-override",
    code: 'import { v4 as makeKey } from "uuid";\nimport { DataGrid } from "@mui/x-data-grid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nexport const Example = () => { const columns = [{field:"label",renderCell:()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}/>)}</>;}}].map((column)=>({...column, renderCell:()=>null})); return <DataGrid columns={columns} rows={[]} />; };\n',
    expectedCount: 0,
  },
  {
    name: "event-only-jsx-factory",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst createView=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}/>)}</>;}; export const Example=()=>{const [view,setView]=useState(null);return <><button onClick={()=>setView(createView())}>Build</button>{view}</>;};\n',
    expectedCount: 0,
  },
  {
    name: "mixed-unknown-dispatcher-result",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards=(fresh)=> fresh ? [{token:makeKey(),label:"Ready"}] : retainedCards;\nconst Cards = () => { const cards=makeCards(flag); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "type-only-uuid-runtime-use",
    code: 'import type {v4 as makeKey} from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards=makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "additional-uuid-namespace-exposure",
    code: 'import { v4 as makeKey } from "uuid";\nimport * as identifierModule from "uuid"; inspect(identifierModule);\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards=makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "source-visible-array-method-replacement",
    code: 'import { v4 as makeKey } from "uuid";\nArray.prototype.push = function() { return 0; }; const makeCards=()=>{const cards=[];cards.push({token:makeKey(),label:"Ready"});return cards;};\nconst Cards = () => { const cards=makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "legacy-direct-random-key-positive",
    code: "export const Example=()=> <span key={Math.random()}>Ready</span>;\n",
    expectedCount: 1,
  },
  {
    name: "persistent-element-created-by-event",
    code: 'import { v4 as makeKey } from "uuid";\nimport {useState} from "react"; export const Example=()=>{const [views,setViews]=useState([]);return <><button onClick={()=>setViews((previous)=>[...previous,<span key={makeKey()}>Ready</span>])}>Add</button>{views}</>;};\n',
    expectedCount: 0,
  },
  {
    name: "async-factory",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards=async()=>[{token:makeKey(),label:"Ready"}];\nconst Cards = () => { const cards=makeCards(); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "recursive-factory",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards=(again)=>again?makeCards(false):[{token:makeKey(),label:"Ready"}];\nconst Cards = () => { const cards=makeCards(false); return <section>{cards.map((card) => <span key={card.token}>{card.label}</span>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "unknown-render-property-consumer",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst options={renderCell:()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}/>)}</>;}}; export const Example=()=> <UnknownWidget options={options}/>;\n',
    expectedCount: 0,
  },
  {
    name: "optional-map-transport",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards=makeCards(); return <section>{cards?.map((card)=><span key={card.token}/>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "computed-item-key-read",
    code: 'import { v4 as makeKey } from "uuid";\nconst makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards = () => { const cards=makeCards(); return <section>{cards.map((card)=><span key={card["token"]}/>)}</section>; }; export const Example = () => <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "unreachable-render-source",
    code: 'import { v4 as makeKey } from "uuid"; const makeCards = () => [{ token: makeKey(), label: "Ready" }];\nconst Cards=()=>{return null;const cards=makeCards();return <>{cards.map((card)=><span key={card.token}/>)}</>;};export const Example=()=> <Cards/>;\n',
    expectedCount: 0,
  },
  {
    name: "item-alias-assignment-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=>{const alias=card;alias.token="stable";return <span key={card.token}/>;})}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "item-pattern-write-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=>{[card.token]=replacement;return <span key={card.token}/>;})}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "item-for-of-target-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=>{for(card.token of tokens){}return <span key={card.token}/>;})}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "factory-value-escape-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; consume(makeCards);const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "uuid-value-escape-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; consume(makeKey);const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "local-array-escape-before-return",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>{const cards=[{token:makeKey(),label:"Ready"}];consume(cards);return cards;}; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "unknown-push-spread-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>{const cards=[];cards.push(...retainedCards);return cards;}; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "duplicate-key-property-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),token:"stable",label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "accessor-property-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),get label(){return "Ready";}}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "object-prototype-property-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{__proto__:prototypeValue,token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "runtime-loader-import-abstention",
    code: 'import {createRequire}from "node:module";import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "runtime-dynamic-import-abstention",
    code: 'const otherProvider=import("uuid");import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "type-only-loader-import-preserves-origin",
    code: 'import type {createRequire}from "node:module";import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "genuine-object-exposure-abstention",
    code: 'const nativeObject=Object;import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "shadowed-object-preserves-origin",
    code: 'const Object={label:"local"};import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "genuine-global-alias-abstention",
    code: 'const realm=globalThis;import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "shadowed-window-preserves-origin",
    code: 'const window={label:"local"};import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "constructor-projection-abstention",
    code: 'const compile=(()=>null).constructor;import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "constructor-destructure-abstention",
    code: 'const {constructor:compile}=()=>null;import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "erased-type-query-preserves-origin",
    code: 'type ObjectShape=typeof Object;import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "evaluated-typescript-wrapper-exposure-abstention",
    code: 'const nativeObject=(Object as unknown);import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "runtime-enum-abstention",
    code: 'enum LocalMode {Ready=1} import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "direct-component-call-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};const snapshot=Cards();export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "type-only-uuid-namespace-preserves-origin",
    code: 'import type * as IdentifierTypes from "uuid";import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "map-as-retained-initial-content",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const Cards=()=>{const cards=makeCards();return <Retain initialContent={cards.map((card)=><span key={card.token}>{card.label}</span>)}/>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "map-as-retained-custom-children",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const Cards=()=>{const cards=makeCards();return <Retain>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Retain>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "discarded-keyed-element-in-map",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=>{const unused=<span key={card.token}>{card.label}</span>;return <b/>;})}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "callback-keyed-element-as-initial-content",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><Retain initialContent={<span key={card.token}>{card.label}</span>}/>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "callback-keyed-element-as-retained-children",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><Retain><span key={card.token}>{card.label}</span></Retain>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "fragment-children-through-both-returns",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <>{cards.map((card)=><><span key={card.token}>{card.label}</span></>)}</>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "canonical-stack-literal-layout-children",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; const Cards=()=>{const cards=makeCards();return <Stack direction="row" spacing={1}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "stack-component-carrier-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const Cards=()=>{const cards=makeCards();return <Stack component={Retain}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "stack-as-carrier-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const Cards=()=>{const cards=makeCards();return <Stack as={Retain}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "stack-spread-carrier-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const layoutProps={}; const Cards=()=>{const cards=makeCards();return <Stack {...layoutProps}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "stack-children-carrier-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const Cards=()=>{const cards=makeCards();return <Stack children={null}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "foreign-stack-children-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "layout-kit"; const Cards=()=>{const cards=makeCards();return <Stack>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "type-only-stack-runtime-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import type {Stack} from "@mui/material"; const Cards=()=>{const cards=makeCards();return <Stack>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "canonical-stack-whole-binding-escape",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; const capturedStack=Stack; const Cards=()=>{const cards=makeCards();return <Stack>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "named-default-uuid-carrier",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {default as IdentifierRuntime} from "uuid"; void IdentifierRuntime; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "named-default-grid-carrier",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {default as GridRuntime} from "@mui/x-data-grid"; void GridRuntime; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "type-only-uuid-runtime-read",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import type * as IdentifierTypes from "uuid"; void IdentifierTypes; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "type-only-grid-runtime-read",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {type DataGrid as GridType} from "@mui/x-data-grid"; void GridType; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "type-only-loader-runtime-read",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import type {createRequire} from "node:module"; void createRequire; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "evaluated-typescript-export-assignment",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;export = Object;',
    expectedCount: 0,
  },
  {
    name: "canonical-stack-import-alias",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack as Flow} from "@mui/material"; const Cards=()=>{const cards=makeCards();return <Flow direction="row" spacing={1}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Flow>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "nested-native-children-in-callback",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><div><span key={card.token}>{card.label}</span></div>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "canonical-grid-with-stack-child",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; import {DataGrid} from "@mui/x-data-grid"; export const Example=()=>{const columns=[{field:"label",renderCell:()=>{const cards=makeCards();return <Stack direction="row" spacing={1}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;}}];return <DataGrid columns={columns} rows={[]}/>;};',
    expectedCount: 1,
  },
  {
    name: "native-wrapper-explicit-children-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; const Cards=()=>{const cards=makeCards();return <section children={null}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "same-module-stack-theme-component-retention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; import {ThemeProvider} from "@mui/material/styles"; import {useState} from "react"; const Retain=({initialContent,children})=>{const [content]=useState(initialContent ?? children);return content;}; const Cards=()=>{const cards=makeCards();return <ThemeProvider theme={{components:{MuiStack:{defaultProps:{component:Retain}}}}}><Stack>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack></ThemeProvider>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "canonical-theme-creation-exposure",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; import {createTheme} from "@mui/material"; void createTheme; const Cards=()=>{const cards=makeCards();return <Stack>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "same-module-stack-default-property-exposure",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>[{token:makeKey(),label:"Ready"}]; import {Stack} from "@mui/material"; const themeSettings={MuiStack:{defaultProps:{}}}; const Cards=()=>{const cards=makeCards();return <Stack>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "nonreturned-factory-self-call-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>{makeCards();return[{token:makeKey(),label:"Ready"}];};const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "nonreturned-local-mutual-cycle-abstention",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>{touchCards();return[{token:makeKey(),label:"Ready"}];};const touchCards=()=>makeCards();const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "returned-dispatcher-expression-preserves-origin",
    code: 'import {v4 as makeKey} from "uuid"; const makeLeaf=()=>[{token:makeKey(),label:"Ready"}];const makeCards=()=>makeLeaf();const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 1,
  },
  {
    name: "statically-dead-push-is-not-fresh-witness",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>{const cards=[];if(false)cards.push({token:makeKey(),label:"Ready"});return cards;};const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "post-return-array-is-not-fresh-witness",
    code: 'import {v4 as makeKey} from "uuid"; const makeCards=()=>{return [];return[{token:makeKey(),label:"Ready"}];};const Cards=()=>{const cards=makeCards();return <section>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</section>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
  {
    name: "computed-literal-stack-theme-default-carrier",
    code: 'import {v4 as makeKey} from "uuid"; import {Stack,useTheme} from "@mui/material";import {useState} from "react";const Retain=({children})=>{const [content]=useState(children);return content;};const componentName="MuiStack";const defaultsName="defaultProps";const makeCards=()=>[{token:makeKey(),label:"Ready"}];const Cards=()=>{const theme=useTheme();theme.components ??= {};theme.components[componentName]={[defaultsName]:{component:Retain}};const cards=makeCards();return <Stack direction="row" spacing={1}>{cards.map((card)=><span key={card.token}>{card.label}</span>)}</Stack>;};export const Example=()=> <Cards/>;',
    expectedCount: 0,
  },
];

describe("no-random-key local resource provider", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noRandomKey, testCase.code, commonOptions);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
