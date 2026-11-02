import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type {
  SourceProjectIndex,
  SourceProjectModule,
} from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getNodeEndIndex } from "../../../utils/get-node-end-index.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { collectOwnedDomLifecycleUses } from "./collect-owned-dom-lifecycle-uses.js";
import { isReadonlyNativeSnapshot } from "./is-readonly-native-snapshot.js";

interface LifecycleFixture {
  readonly name: string;
  readonly source: string;
  readonly selectedNativeText: string;
  readonly approved?: boolean;
  readonly hasApprovedListeners?: boolean;
}

const PORTAL_SOURCE = `
import React from 'react';
import {createPortal} from 'react-dom';
export class Overlay extends React.Component {
  parent=document.body;
  layer=document.createElement('section');
  componentDidMount(){this.parent.appendChild(this.layer);}
  componentWillUnmount(){this.parent.removeChild(this.layer);}
  render(){return createPortal(<div/>,this.layer);}
}`;

const FOCUS_SOURCE = `
import React from 'react';
import {createPortal} from 'react-dom';
export class Notice extends React.Component {
  layer=document.createElement('section');
  componentDidMount(){document.body.appendChild(this.layer);this.focusNode(document.querySelector('.command'));}
  componentWillUnmount(){document.body.removeChild(this.layer);}
  focusNode=element=>{if(element&&element!==null)element.focus();};
  render(){return createPortal(<button/>,this.layer);}
}`;

const COLLECTION_SOURCE = `
import React from 'react';
import {createPortal} from 'react-dom';
export class Dialog extends React.Component {
  layer=document.createElement('section');
  nodes=[]; first=null; last=null;
  componentDidMount(){
    document.body.appendChild(this.layer);
    this.nodes=this.layer.querySelectorAll('input,button');
    const firstInput=[...this.nodes].findIndex(node=>node.nodeName==='INPUT');
    this.first=this.nodes[firstInput>-1?firstInput:0];
    this.last=this.nodes[this.nodes.length-1];
    this.first.focus();
  }
  componentWillUnmount(){document.body.removeChild(this.layer);}
  render(){return createPortal(<div/>,this.layer);}
}`;

const LISTENER_SOURCE = `
import React from 'react';
export class Keys extends React.Component {
  parent=document.body;
  onKey=event=>{if(event.key==='Escape')event.preventDefault();};
  componentDidMount(){window.addEventListener('keydown',this.onKey);}
  componentWillUnmount(){window.removeEventListener('keydown',this.onKey);}
  render(){return <div/>;}
}`;

const fixtures: ReadonlyArray<LifecycleFixture> = [
  {
    name: "conditional constructor alias callback refuses",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  constructor(){super();const handler=event=>{event.target[opaque]=replacement};this.onSurface=handler} componentDidMount(){",
    ).replace("createPortal(<div/>", "createPortal(<div onClick={flag?this.onSurface:onClose}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "same-module callback implicit global event refuses",
    source:
      PORTAL_SOURCE.replace("createPortal(<div/>", "createPortal(<div onClick={danger}/>") +
      "\nconst danger=()=>{event.target[opaque]=replacement};",
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "conditional own method event callback refuses",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  onSurface=event=>{event.target[opaque]=replacement}; componentDidMount(){",
    ).replace("createPortal(<div/>", "createPortal(<div onClick={flag?this.onSurface:onClose}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "conditional own local event callback refuses",
    source: PORTAL_SOURCE.replace(
      "render(){return",
      "render(){const onSurface=event=>{event.target[opaque]=replacement};return",
    ).replace("createPortal(<div/>", "createPortal(<div onClick={flag?onSurface:onClose}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "same-module event target mutation refuses",
    source:
      PORTAL_SOURCE.replace("createPortal(<div/>", "createPortal(<div onClick={danger}/>") +
      "\nconst danger=event=>{event.target[opaque]=replacement};",
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "same-module scalar event data remains ordinary",
    source:
      PORTAL_SOURCE.replace("createPortal(<div/>", "createPortal(<div onKeyDown={readKey}/>") +
      "\nconst readKey=event=>notify(event.key);",
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "constructor assigned own JSX callback is unsupported",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  constructor(){super();this.onSurface=event=>{event.target[opaque]=replacement}} componentDidMount(){",
    ).replace("createPortal(<div/>", "createPortal(<div onClick={this.onSurface}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "inline own JSX event target mutation refuses",
    source: PORTAL_SOURCE.replace(
      "createPortal(<div/>",
      "createPortal(<div onClick={event=>{event.target[opaque]=replacement}}/>",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "inline own JSX scalar event data remains ordinary",
    source: PORTAL_SOURCE.replace(
      "createPortal(<div/>",
      "createPortal(<div onKeyDown={event=>notify(event.key)}/>",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "render-local own JSX event target mutation refuses",
    source: PORTAL_SOURCE.replace(
      "render(){return",
      "render(){const onSurface=event=>{event.target[opaque]=replacement};return",
    ).replace("createPortal(<div/>", "createPortal(<div onClick={onSurface}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "render-local own JSX event scalar data remains ordinary",
    source: PORTAL_SOURCE.replace(
      "render(){return",
      "render(){const onSurface=event=>notify(event.key);return",
    ).replace("createPortal(<div/>", "createPortal(<div onKeyDown={onSurface}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "own method JSX callback extracted alias declines",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  onSurface=event=>{event.target[opaque]=replacement}; componentDidMount(){",
    )
      .replace("render(){return", "render(){const onSurface=this.onSurface;return")
      .replace("createPortal(<div/>", "createPortal(<div onClick={onSurface}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "readonly own class alias",
    source: PORTAL_SOURCE + "\nconst Alias=Overlay;const view=<Alias/>;",
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "explicit own class instance ref",
    source: PORTAL_SOURCE + "\nconst view=<Overlay ref={observe}/>;",
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "own portal field mount unmount",
    source: PORTAL_SOURCE,
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "ordinary body instance storage",
    source: PORTAL_SOURCE,
    selectedNativeText: "document.body",
    approved: true,
  },
  {
    name: "own guarded query focus borrow",
    source: FOCUS_SOURCE,
    selectedNativeText: "document.querySelector('.command')",
    approved: true,
  },
  {
    name: "native collection snapshot and numeric endpoints",
    source: COLLECTION_SOURCE,
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "field unknown replacement",
    source: PORTAL_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){this.layer=foreign;",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "field prototype setter",
    source: PORTAL_SOURCE.replace(
      "  layer=document.createElement('section');",
      "  get layer(){return document.createElement('section');}",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "field getter override",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  get layer(){return document.body;} componentDidMount(){",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "field raw escape",
    source: PORTAL_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){configure(this.layer);",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "field method replacement",
    source: PORTAL_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){this.layer.focus=foreign;",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "field destructuring mutation",
    source: PORTAL_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){[this.layer]=replacement;",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "whole instance escape",
    source: PORTAL_SOURCE.replace("componentDidMount(){", "componentDidMount(){configure(this);"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "instance alias",
    source: PORTAL_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){const instance=this;",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "nested ordinary function foreign this",
    source: PORTAL_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){function publish(){this.extra=document.body;}publish.call(foreign);",
    ),
    selectedNativeText: "document.body",
    approved: false,
  },
  {
    name: "class prototype mutation",
    source: PORTAL_SOURCE + "\nOverlay.prototype.layer=foreign;",
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "named class expression public binding cannot carry a subclass override",
    source:
      PORTAL_SOURCE.replace(
        "export class Overlay extends",
        "export const Overlay=class InternalOverlay extends",
      ) + "; class Changed extends Overlay{get layer(){return foreign}}",
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "visible subclass override",
    source: PORTAL_SOURCE + "\nclass Changed extends Overlay{get layer(){return foreign}}",
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "guarded focus helper replacement",
    source: FOCUS_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){this.focusNode=foreign;",
    ),
    selectedNativeText: "document.querySelector('.command')",
    approved: false,
  },
  {
    name: "guarded focus helper extraction",
    source: FOCUS_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){const focus=this.focusNode;configure(focus);",
    ),
    selectedNativeText: "document.querySelector('.command')",
    approved: false,
  },
  {
    name: "focus helper extra work",
    source: FOCUS_SOURCE.replace("element.focus();", "{foreign();element.focus();}"),
    selectedNativeText: "document.querySelector('.command')",
    approved: false,
  },
  {
    name: "focus helper parameter escape",
    source: FOCUS_SOURCE.replace("element.focus();", "{configure(element);element.focus();}"),
    selectedNativeText: "document.querySelector('.command')",
    approved: false,
  },
  {
    name: "focus helper default parameter",
    source: FOCUS_SOURCE.replace("focusNode=element=>", "focusNode=(element=foreign())=>"),
    selectedNativeText: "document.querySelector('.command')",
    approved: false,
  },
  {
    name: "collection snapshot item escape",
    source: COLLECTION_SOURCE.replace("node=>node.nodeName==='INPUT'", "node=>configure(node)"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "collection unknown field write",
    source: COLLECTION_SOURCE.replace(
      "this.nodes=this.layer.querySelectorAll",
      "this.nodes=foreign;this.nodes=this.layer.querySelectorAll",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "collection method mutation",
    source: COLLECTION_SOURCE.replace(
      "this.first.focus();",
      "this.nodes[0].focus=foreign;this.first.focus();",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "ordinary class key scalar listener",
    source: LISTENER_SOURCE,
    selectedNativeText: "document.body",
    approved: true,
    hasApprovedListeners: true,
  },
  {
    name: "class listener target mutation",
    source: LISTENER_SOURCE.replace(
      "if(event.key==='Escape')event.preventDefault();",
      "event.target.focus=foreign;",
    ),
    selectedNativeText: "document.body",
    hasApprovedListeners: false,
  },
  {
    name: "class listener target escape",
    source: LISTENER_SOURCE.replace(
      "if(event.key==='Escape')event.preventDefault();",
      "configure(event.target);",
    ),
    selectedNativeText: "document.body",
    hasApprovedListeners: false,
  },
  {
    name: "class listener callback extraction",
    source: LISTENER_SOURCE.replace(
      "window.addEventListener('keydown',this.onKey);",
      "const callback=this.onKey;window.addEventListener('keydown',callback);",
    ),
    selectedNativeText: "document.body",
    hasApprovedListeners: false,
  },
  {
    name: "known literal spread ref is visible instance exposure",
    source:
      PORTAL_SOURCE + "\nconst Example=()=> <Overlay {...{ref: instance=>configure(instance)}}/>;",
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "ordinary unknown prop spread retains declared React purpose",
    source: PORTAL_SOURCE + "\nconst Example=args=> <Overlay {...args}/>;",
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "finite story constructor metadata remains ordinary usage",
    source: PORTAL_SOURCE + "\nexport default {title:'Invented overlay',component:Overlay};",
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "story metadata extra getter is unsupported",
    source:
      PORTAL_SOURCE +
      "\nexport default {title:'Invented overlay',component:Overlay,get capture(){return Overlay}};",
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "readonly static component JSX slot derives from its own declaration",
    source:
      PORTAL_SOURCE.replace(
        "import {createPortal}",
        "import {Component as Part} from 'react'; import {createPortal}",
      ).replace("  parent=document.body;", "  static Part=Part; parent=document.body;") +
      "\nconst Example=()=> <Overlay.Part/>;",
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "own native field method cannot be extracted",
    source: PORTAL_SOURCE.replace(
      "componentDidMount(){",
      "componentDidMount(){const destroy=this.componentWillUnmount;configure(destroy);",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "static this is not an instance field origin",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  static publish(){this.foreign=document.body;} componentDidMount(){",
    ),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "no-expression multiline selector retains ordinary query role",
    source: COLLECTION_SOURCE.replace("'input,button'", "`input,\nbutton`"),
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "unrelated collection length cannot select native endpoint",
    source: COLLECTION_SOURCE.replace("this.nodes.length-1", "otherNodes.length-1"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "class own JSX event target strict identity retains purpose",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  onSurface=({target})=>{if(target===null)notify();}; componentDidMount(){",
    ).replace("createPortal(<div/>", "createPortal(<div onClick={this.onSurface}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "class own JSX event target capability mutation refuses",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  onSurface=({target})=>{target[['focus'][0]]=replacement;}; componentDidMount(){",
    ).replace("createPortal(<div/>", "createPortal(<div onClick={this.onSurface}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "class own JSX callback scalar data remains admitted",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  onSurface=event=>notify(event.key); componentDidMount(){",
    ).replace("createPortal(<div/>", "createPortal(<div onKeyDown={this.onSurface}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: true,
  },
  {
    name: "class own JSX callback default parameter refuses",
    source: PORTAL_SOURCE.replace(
      "  componentDidMount(){",
      "  onSurface=(event=foreign())=>notify(event.key); componentDidMount(){",
    ).replace("createPortal(<div/>", "createPortal(<div onClick={this.onSurface}/>"),
    selectedNativeText: "document.createElement('section')",
    approved: false,
  },
  {
    name: "key listener global event spelling is not an owned parameter",
    source: LISTENER_SOURCE.replace(
      "onKey=event=>{if(event.key==='Escape')event.preventDefault();};",
      "onKey=()=>{event.target[['focus'][0]]=replacement;};",
    ),
    selectedNativeText: "document.body",
    hasApprovedListeners: false,
  },
  {
    name: "key listener literal capture is supported",
    source: LISTENER_SOURCE.replace("'keydown',this.onKey)", "'keydown',this.onKey,true)"),
    selectedNativeText: "document.body",
    approved: true,
    hasApprovedListeners: true,
  },
  {
    name: "key listener executable capture is unsupported",
    source: LISTENER_SOURCE.replace("'keydown',this.onKey)", "'keydown',this.onKey,readCapture())"),
    selectedNativeText: "document.body",
    hasApprovedListeners: false,
  },
];

const isNativeDocumentSource = (raw: EsTreeNode, module: SourceProjectModule): boolean => {
  const node = stripParenExpression(raw);
  const member = isNodeOfType(node, "CallExpression") ? stripParenExpression(node.callee) : node;
  if (!isNodeOfType(member, "MemberExpression")) return false;
  const receiver = stripParenExpression(member.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "document" ||
    !module.scopes.isGlobalReference(receiver)
  )
    return false;
  const name = getStaticPropertyName(member);
  return isNodeOfType(node, "CallExpression")
    ? name === "createElement" || name === "querySelector" || name === "querySelectorAll"
    : name === "body" || name === "activeElement";
};

describe("collectOwnedDomLifecycleUses", () => {
  for (const fixture of fixtures)
    it(fixture.name, () => {
      const parsed = parseFixture(fixture.source);
      expect(parsed.errors).toEqual([]);
      if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program");
      attachParentReferences(parsed.program);
      const module: SourceProjectModule = {
        filePath: "/invented/overlay.tsx",
        programNode: parsed.program,
        scopes: analyzeScopes(parsed.program),
      };
      const index: SourceProjectIndex = {
        modulesByFilePath: new Map([[module.filePath, module]]),
        htmlFilePaths: [],
        consumerModulesByFilePath: new Map(),
        resolvedSourcePathByNode: new WeakMap(),
        unresolvedRuntimeSources: new Set(["react", "react-dom"]),
        hasOpaqueMdxConsumerSurface: false,
      };
      const result = collectOwnedDomLifecycleUses({
        module,
        index,
        isNativeValue: (value) => isNativeDocumentSource(value, module),
        isPortalContainer: (raw, value) => {
          const call = stripParenExpression(raw);
          if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
          const [, container] = call.arguments;
          if (container !== value) return false;
          const imported = resolveImportedApiReference(
            stripParenExpression(call.callee),
            module.scopes,
          );
          return imported?.source === "react-dom" && imported.importedName === "createPortal";
        },
        isReadonlyNativeSnapshot,
      });
      const hasSelectedApproval = [...result.approvedNativeUseNodes].some(
        (node) =>
          fixture.source.slice(getNodeStartIndex(node), getNodeEndIndex(node)) ===
          fixture.selectedNativeText,
      );
      if (fixture.approved !== undefined) expect(hasSelectedApproval).toBe(fixture.approved);
      if (fixture.hasApprovedListeners !== undefined)
        expect(Boolean(result.approvedListenerCalls.size)).toBe(fixture.hasApprovedListeners);
    });
});
