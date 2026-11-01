import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { collectCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { defineRule } from "../../utils/define-rule.js";
import { isInheritedStringTokenReceiver } from "../../utils/is-inherited-string-token-receiver.js";
import * as parserModule from "../../utils/parse-source-file.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface TokenFixture {
  readonly name: string;
  readonly code: string;
  readonly providers: Readonly<Record<string, string>>;
  readonly certificate: boolean;
  readonly quiet: boolean;
}

const fixtures: TokenFixture[] = [
  {
    name: "same-file-plain-inherited-string",
    code: "interface TokenData {text:string}\ninterface ViewProps extends TokenData {}\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {},
    certificate: true,
    quiet: true,
  },
  {
    name: "relative-imported-base-string",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "tsconfig-alias-source-fitting-imported-base",
    code: "import type { TokenData } from '@/types/token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/types/token-data.ts": "export interface TokenData { text: string }\n",
      "tsconfig.json":
        '{"compilerOptions": {"baseUrl": ".", "paths": {"@/*": ["src/*"]}, "jsx": "preserve"}}',
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "type-only-renamed-base",
    code: "import type { TokenData as ImportedData } from './token-data';\ninterface ViewProps extends ImportedData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "number-property",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData {text:number}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "any-property",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData {text:any}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "unknown-or-union-property",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts":
        "export interface TokenData {text:string|{split(pattern:RegExp):unknown[]}}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "own-overriding-property",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { text: {split(pattern:RegExp):unknown[]};onClear?:()=>void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "duplicate-conflicting-provider-declarations",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts":
        "export interface TokenData {text:string}\nexport interface TokenData {text:number}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "multiple-base-ambiguity",
    code: "import type { TokenData } from './token-data';\ninterface OtherData {text:number}\ninterface ViewProps extends TokenData, OtherData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "generic-base-unsupported",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData<string> { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData<Value> {text:Value}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "barrel-reexport-outside-one-hop",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export {TokenData} from './actual';\n",
      "src/actual.ts": "export interface TokenData{text:string}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "missing-provider",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {},
    certificate: false,
    quiet: false,
  },
  {
    name: "malformed-provider",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "stateful-input-child",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}><input defaultValue={part}/></span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: false,
  },
  {
    name: "component-descendant",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}><Editor value={part}/></span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: false,
  },
  {
    name: "selected-binding-reassigned",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{text=readReplacement();const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "unknown-custom-split-method",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData {text:{split(pattern:RegExp):unknown[]}}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "visible-string-split-provider-replacement",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nString.prototype.split=()=>readRows();\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "provider-content-change",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "provider-appearance-after-negative-probe",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {},
    certificate: false,
    quiet: false,
  },
  {
    name: "alias-config-target-change",
    code: "import type { TokenData } from '@/types/token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/types/token-data.ts": "export interface TokenData { text: string }\n",
      "src/replaced/token-data.ts": "export interface TokenData{text:number}\n",
      "tsconfig.json": '{"compilerOptions": {"baseUrl": ".", "paths": {"@/*": ["src/*"]}}}',
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "direct-literal-regexp-splitter",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const content=text?.split(/([,;])/g).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "direct-literal-string-splitter",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const content=text?.split(',').map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "omitted-splitter",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const content=text?.split().map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "unrelated-provider-declaration-merge",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts":
        "export interface TokenData { text: string }\nexport interface Unrelated { first: string }\nexport interface Unrelated { second: string }\n",
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "custom-symbol-split-produces-stateful-token",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator={[Symbol.split](){return [<input defaultValue='x'/>]}};const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "regexp-own-symbol-split-replacement",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;separator[Symbol.split]=()=>[<input defaultValue='x'/>];const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "regexp-prototype-symbol-split-replacement",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nRegExp.prototype[Symbol.split]=()=>[];export const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "splitter-escapes",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;alter(separator);const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "nearer-generic-type-shadow",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=<ViewProps,>({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "nested-base-interface-collision",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n\nconst shadow=()=>{interface TokenData{text:number};return null};",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "computed-catch-destructured-binding-write",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{try{throw {}}catch({[({text}={text:readReplacement()})]:ignored}){}const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "selected-default-pattern",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text='fallback'}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: true,
  },
  {
    name: "selected-rest-pattern",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text,...remaining}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "selected-computed-pattern",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({['text']:text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "ts-parameter-property-unsupported",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n\nclass Holder{constructor(public value:string){}}",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "runtime-ts-export-assignment-unsupported",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n\nexport = mutateIntrinsics();",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "transparent-eval-capability",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\n(eval as any)('String.prototype.split=()=>[]');export const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "nested-window-dynamic-capability",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nwindow.self[method]('replace');export const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "literal-constructor-extraction",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nconst {'constructor':makeCode}=()=>{};makeCode('replace')();export const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "optional-provider-property",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text?: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "provider-index-signature",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData {text:string;[key:string]:unknown}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "provider-extends-second-graph",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts":
        "interface Earlier{text:string}\nexport interface TokenData extends Earlier{}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "type-alias-not-interface",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export type TokenData={text:string};\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "declaration-file-provider-unsupported",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.d.ts": "export interface TokenData {text:string}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "default-type-import-route-unsupported",
    code: "import type TokenData from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export default interface TokenData{text:string}\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "namespace-type-import-route-unsupported",
    code: "import type * as Types from './token-data';\ninterface ViewProps extends Types.TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "old-own-string-proof-stays-first",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { text:string;onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: true,
  },
  {
    name: "nearer-class-shadows-props",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nfunction Outer(){class ViewProps{text=readReplacement()} const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};return <TokenLine text={readReplacement()}/>;}\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "class-merges-imported-base-name",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n\nclass TokenData{text=readReplacement()}\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "exported-splitter-is-an-escape",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const separator=/([,;])/g;\nexport const TokenLine=({text}:ViewProps)=>{const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "provider-visible-reflective-intrinsic-write",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps)=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts":
        'export interface TokenData{text:string}\nReflect.set(String.prototype,"split",()=>[]);\n',
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "outer-parameter-default-unsupported",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text}:ViewProps={text:readReplacement()})=>{const separator=/([,;])/g;const content=text?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: false,
    quiet: false,
  },
  {
    name: "plain-renamed-destructured-field",
    code: "import type { TokenData } from './token-data';\ninterface ViewProps extends TokenData { onClear?: () => void }\nexport const TokenLine=({text:shown}:ViewProps)=>{const separator=/([,;])/g;const content=shown?.split(separator).map((part,index)=>{if(index%2===1)return <span key={index}>{part}</span>;return part;});return <p>{content}</p>;};\n",
    providers: {
      "src/token-data.ts": "export interface TokenData { text: string }\n",
    },
    certificate: true,
    quiet: true,
  },
  {
    name: "computed-local-function-constructor-replaces-string-split",
    code: "interface TokenData { text: string }\ninterface ViewProps extends TokenData {}\nglobalThis.makeToken=()=> <input defaultValue='x'/>;\nconst capability='constructor';\nconst compile=(()=>{})[capability];\ncompile(\"String.prototype.split=()=>[globalThis.makeToken(),globalThis.makeToken()]\")();\nexport const TokenLine=({text}:ViewProps)=>{\n  const separator=/([,;])/g;\n  return <p>{text.split(separator).map((part,index)=><span key={index}>{part}</span>)}</p>;\n};\n",
    providers: {},
    certificate: false,
    quiet: false,
  },
];

const certificateRule = defineRule({
  id: "inherited-string-token-certificate-test",
  title: "Inherited string token certificate",
  severity: "warn",
  recommendation: "test",
  create: (context: RuleContext) => ({
    CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
      if (isInheritedStringTokenReceiver(node, context.filename, context.scopes))
        context.report({ node, message: "Inherited string token receiver" });
    },
  }),
});

let directory: string;
const writeFile = (relativePath: string, contents: string): string => {
  const filename = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
  return filename;
};
const prepare = (fixture: TokenFixture): string => {
  for (const [filename, contents] of Object.entries(fixture.providers))
    writeFile(filename, contents);
  return writeFile("src/token-line.tsx", fixture.code);
};
const keyDiagnostic = {
  message:
    'Your users can see & submit the wrong data when this list reorders or filters, so use a stable id like `key={item.id}`, not the array index "index".',
  nodeType: "JSXAttribute",
};
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-inherited-tokens-"));
  resetFilesystemCaches();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetFilesystemCaches();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("inherited string split tokens", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const filename = prepare(fixture);
      expect(runRule(certificateRule, fixture.code, { filename }).diagnostics).toEqual(
        fixture.certificate
          ? [{ message: "Inherited string token receiver", nodeType: "CallExpression" }]
          : [],
      );
      expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual(
        fixture.quiet ? [] : [keyDiagnostic],
      );
    });
  }

  it("keeps the old verdict when provider analysis throws", () => {
    const fixture = fixtures[1];
    const filename = prepare(fixture);
    vi.spyOn(parserModule, "parseSourceFile").mockImplementation(() => {
      throw new Error("unavailable provider analysis");
    });
    expect(runRule(certificateRule, fixture.code, { filename }).diagnostics).toEqual([]);
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([
      keyDiagnostic,
    ]);
  });

  it("does not require a filename on the old own-string proof", () => {
    const fixture = fixtures.find((entry) => entry.name === "old-own-string-proof-stays-first");
    if (!fixture) throw new Error("Missing old own-string fixture");
    expect(runRule(noArrayIndexAsKey, fixture.code).diagnostics).toEqual([]);
  });

  it("records the same provider and negative candidates as the detector", () => {
    const fixture = fixtures[1];
    const filename = prepare(fixture);
    const provider = path.join(directory, "src/token-data.tsx");
    fs.renameSync(path.join(directory, "src/token-data.ts"), provider);
    const unrelated = writeFile("src/unrelated.ts", "export const untouched = true;");
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: fixture.code,
      ruleIds: ["no-array-index-as-key"],
    });
    const detectorTrace = collectCrossFileProbes(() =>
      runRule(noArrayIndexAsKey, fixture.code, { filename }),
    );
    expect(trace).not.toBeNull();
    for (const contentPath of detectorTrace.contentPaths)
      expect(trace?.contentPaths.has(contentPath)).toBe(true);
    for (const existencePath of detectorTrace.existencePaths)
      expect(trace?.existencePaths.has(existencePath)).toBe(true);
    expect(trace?.contentPaths.has(provider)).toBe(true);
    expect(trace?.contentPaths.has(unrelated)).toBe(false);
    expect(trace?.existencePaths.has(path.join(directory, "src/token-data.ts"))).toBe(true);
    const cachedTrace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: fixture.code,
      ruleIds: ["no-array-index-as-key"],
    });
    expect(cachedTrace?.contentPaths.has(provider)).toBe(true);
  });

  it("records unresolved type-only candidates and alias configuration", () => {
    const fixture = fixtures[2];
    const filename = prepare(fixture);
    fs.unlinkSync(path.join(directory, "src/types/token-data.ts"));
    resetFilesystemCaches();
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: fixture.code,
      ruleIds: ["no-array-index-as-key"],
    });
    expect(trace?.contentPaths.has(path.join(directory, "tsconfig.json"))).toBe(true);
    expect(trace?.existencePaths.has(path.join(directory, "src/types/token-data.ts"))).toBe(true);
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([
      keyDiagnostic,
    ]);
  });

  it("tracks provider edits, deletion, and appearance between explicit host resets", () => {
    const fixture = fixtures[1];
    const filename = prepare(fixture);
    const provider = path.join(directory, "src/token-data.ts");
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([]);
    writeFile("src/token-data.ts", "export interface TokenData { text: number }\n");
    resetFilesystemCaches();
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([
      keyDiagnostic,
    ]);
    fs.unlinkSync(provider);
    resetFilesystemCaches();
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([
      keyDiagnostic,
    ]);
    writeFile("src/token-data.ts", fixture.providers["src/token-data.ts"]);
    resetFilesystemCaches();
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([]);
  });

  it("tracks an alias target change between explicit host resets", () => {
    const fixture = fixtures[2];
    const filename = prepare(fixture);
    writeFile("src/replaced/token-data.ts", "export interface TokenData { text: number }\n");
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([]);
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/replaced/*"] } } }),
    );
    resetFilesystemCaches();
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([
      keyDiagnostic,
    ]);
  });

  it("handles a same-size provider edit at the explicit parse-cache reset boundary", () => {
    const fixture = fixtures[1];
    const filename = prepare(fixture);
    const provider = path.join(directory, "src/token-data.ts");
    const before = fs.statSync(provider);
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([]);
    const updated = fixture.providers["src/token-data.ts"].replace("string", "number");
    expect(Buffer.byteLength(updated)).toBe(before.size);
    fs.writeFileSync(provider, updated);
    fs.utimesSync(provider, before.atime, before.mtime);
    resetFilesystemCaches();
    expect(runRule(noArrayIndexAsKey, fixture.code, { filename }).diagnostics).toEqual([
      keyDiagnostic,
    ]);
  });
});
