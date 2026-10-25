import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { createNativeFetchJsonIdentityCatchChecker } from "../../utils/create-native-fetch-json-identity-catch-checker.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import type { Rule } from "../../utils/rule.js";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "./no-promise-then-side-effect-in-effect-without-catch.js";

interface NativeIdentityCase {
  readonly name: string;
  readonly source: string;
  readonly certificate: boolean;
  readonly diagnostics: number | null;
  readonly files: Readonly<Record<string, string>>;
}
const certificateProbe: Rule = {
  id: "native-fetch-json-identity-probe",
  severity: "warn",
  create: (context) => {
    const accepts = createNativeFetchJsonIdentityCatchChecker(context);
    return {
      CallExpression: (node) => {
        if (accepts(node)) context.report({ node, message: "native identity catch" });
      },
    };
  },
};
const temporaryRoot = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "rd-native-identity-"),
);
afterAll(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
const writeFile = (directory: string, relativePath: string, source: string) => {
  const filename = path.join(directory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
};
const createProject = (source: string, files: Readonly<Record<string, string>>) => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "project-"));
  writeFile(directory, "package.json", JSON.stringify({ dependencies: { react: "17.0.2" } }));
  for (const [relativePath, content] of Object.entries(files))
    writeFile(directory, relativePath, content);
  writeFile(directory, "entry.tsx", source);
  return { directory, filename: path.join(directory, "entry.tsx") };
};
const resetLookups = () => {
  __clearParseSourceFileCacheForTests();
  resetCrossFileExportCaches();
  resetModuleResolutionCaches();
  resetTsconfigAliasCaches();
};
const cases: ReadonlyArray<NativeIdentityCase> = [
  {
    name: "ordinary native fetch and JSON errors",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "default native request options",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data").then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "sole block return identity",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(function(problem){return problem;});},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "renamed native imports and parameters",
    source:
      'import {useEffect as effect,useState as state} from "react";\n\nexport const Panel=()=>{const [data,updateData]=state(null);effect(()=>{fetch("/data",{method:"GET"}).then(reply=>reply.json()).then(payload=>updateData(payload)).catch(failure=>failure);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "readonly local primitive URL",
    source:
      'import {useEffect,useState} from "react";\nconst url="/data";\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(url,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "static template URL",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(`/data`,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "transparent parameter expressions",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>(response).json()).then(value=>setData((value))).catch(error=>(error as unknown));},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "unrelated browser field mutation",
    source:
      'import {useEffect,useState} from "react";\nwindow.matchMedia=null;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "closed imported string record",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {
      "endpoints.ts":
        'const endpoints={profile:"/data",other:"/other"};export default endpoints;\n',
    },
  },
  {
    name: "additional readonly record consumer",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {
      "endpoints.ts":
        'const endpoints={profile:"/data",other:"/other"};export default endpoints;\n',
      "other.ts":
        'import addresses from "./endpoints";export const load=()=>fetch(addresses.other);',
    },
  },
  {
    name: "unknown URL coercion",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(url,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "request method coercion",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:{toString(){throw Promise.reject(1)}}}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "request spread",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{...options,method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "request getter",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{get method(){return "GET"}}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "custom abort rejection reason",
    source:
      'import {useEffect,useState} from "react";\nconst controller=new AbortController();controller.abort(Promise.reject(1));\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET",signal:controller.signal}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "additional transformation callback",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>transform(value)).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "throwing JSON callback",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>{throw reason;}).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "response alias escape",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>{inspect(response);return response.json();}).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "JSON getter before dispatch",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value.item)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "new callback from JSON",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(()=>value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "async parser",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(async response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "async state callback",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(async value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "identity catch with default initializer",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch((error=unknown())=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "identity catch with destructuring",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(({reason})=>reason);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "identity catch is async",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(async error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "rethrow remains rejected",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>{throw error});},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "arbitrary promise from catch",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>Promise.reject(error));},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "catch parameter overwritten",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>{error=other;return error;});},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "downstream finally remains outside certificate",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error).finally(()=>unknown());},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "fetch replacement",
    source:
      'import {useEffect,useState} from "react";\nglobalThis.fetch=custom;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "fetch raw alias escape",
    source:
      'import {useEffect,useState} from "react";\nconst originalFetch=fetch;configure(originalFetch);\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "Response JSON replacement",
    source:
      'import {useEffect,useState} from "react";\nResponse.prototype.json=custom;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "Promise prototype replacement",
    source:
      'import {useEffect,useState} from "react";\nPromise.prototype.then=custom;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "Error thenable getter",
    source:
      'import {useEffect,useState} from "react";\nObject.defineProperty(Error.prototype,"then",{get(){throw reason}});\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "Object prototype assimilation",
    source:
      'import {useEffect,useState} from "react";\nObject.prototype.then=custom;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "reflection destructuring",
    source:
      'import {useEffect,useState} from "react";\nconst {getPrototypeOf}=Object;const parent=getPrototypeOf({});\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "native constructor alias",
    source:
      'import {useEffect,useState} from "react";\nconst NativeError=TypeError;configure(NativeError);\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "computed provider property mutation",
    source:
      'import {useEffect,useState} from "react";\nPromise[key]=custom;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "source-visible provider field write",
    source:
      'import React,{useEffect,useState} from "react";\nReact.useState=custom;\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: null,
    files: {},
  },
  {
    name: "native setter reassigned",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);setData=custom;useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: null,
    files: {},
  },
  {
    name: "custom setter callback",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const data=null;const setData=custom;useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: null,
    files: {},
  },
  {
    name: "shadowed fetch is not native",
    source:
      'import {useEffect,useState} from "react";\nconst fetch=custom;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: null,
    files: {},
  },
  {
    name: "arbitrary imported promise is not native",
    source:
      'import {useEffect,useState} from "react";\nimport {load} from "external";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{load().then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: null,
    files: {},
  },
  {
    name: "declared JSX pragma",
    source:
      '/** @jsx h */\nimport {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "TS config declaration conservatively refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "tsconfig.json": '{"compilerOptions":{"paths":{"react":["./absent"]}}}',
    },
  },
  {
    name: "active webpack missing-target alias refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2", "webpack": "5.99.0"}, "scripts": {"build": "webpack --config ./webpack.config.js"}}',
      "webpack.config.js": 'module.exports={resolve:{alias:{react:"./absent.js"}}};',
    },
  },
  {
    name: "missing imported record",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "record getter refuses",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "endpoints.ts": "const endpoints={get profile(){return custom;}};export default endpoints;",
    },
  },
  {
    name: "record nonprimitive field refuses",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "endpoints.ts":
        "const endpoints={profile:{toString(){throw reason;}}};export default endpoints;",
    },
  },
  {
    name: "producer mutation refuses",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "endpoints.ts":
        'const endpoints={profile:"/data",other:"/other"};export default endpoints;\nendpoints.profile=other;',
    },
  },
  {
    name: "other consumer mutation refuses",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "endpoints.ts":
        'const endpoints={profile:"/data",other:"/other"};export default endpoints;\n',
      "other.ts": 'import endpoints from "./endpoints";endpoints.profile=other;',
    },
  },
  {
    name: "other consumer raw escape refuses",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "endpoints.ts":
        'const endpoints={profile:"/data",other:"/other"};export default endpoints;\n',
      "other.ts": 'import endpoints from "./endpoints";configure(endpoints);',
    },
  },
  {
    name: "record reexport refuses",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "endpoints.ts": 'export {default} from "./record";',
      "record.ts": 'const endpoints={profile:"/data",other:"/other"};export default endpoints;\n',
    },
  },
  {
    name: "record namespace import refuses",
    source:
      'import {useEffect,useState} from "react";\nimport endpoints from "./endpoints";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch(endpoints.profile,{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "endpoints.ts":
        'const endpoints={profile:"/data",other:"/other"};export default endpoints;\n',
      "other.ts": 'import * as all from "./endpoints";all.default.profile=other;',
    },
  },
  {
    name: "native provider mutation in other module refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "other.ts": "Error.prototype.then=custom;",
    },
  },
  {
    name: "resolved excluded runtime module refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "other.ts": 'import "./mutation.test";',
      "mutation.test.ts": "Promise.prototype.then=custom;",
    },
  },
  {
    name: "runtime loader capability refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "other.ts": 'import vm from "node:vm";vm.runInNewContext(source);',
    },
  },
  {
    name: "native empty catch retains legacy acceptance",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(()=>{});},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 0,
    files: {},
  },
  {
    name: "explicit primitive catch retains legacy acceptance",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(()=>null);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 0,
    files: {},
  },
  {
    name: "passive native Function instanceof",
    source:
      'import {useEffect,useState} from "react";\n\nconst isCallback=(value)=>value instanceof Function;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {},
  },
  {
    name: "native Function constructor capability",
    source:
      'import {useEffect,useState} from "react";\n\nconst construct=Function;\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "HTML without executable source",
    source:
      'import {useEffect,useState} from "react";\n\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {
      "public/index.html": '<!doctype html><div id="root"></div>',
    },
  },
  {
    name: "HTML explicit provider replacement",
    source:
      'import {useEffect,useState} from "react";\n\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "public/index.html": "<script>fetch=custom;</script>",
    },
  },
  {
    name: "missing catch remains a warning",
    source:
      'import {useEffect,useState} from "react";\n\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value));},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "explicit custom webpack configuration refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2", "webpack": "5.99.0"}, "scripts": {"build": "cross-env NODE_ENV=production webpack --config ./tooling/custom.cjs"}}',
      "tooling/custom.cjs": 'module.exports={resolve:{alias:{react:"./absent.js"}}};',
    },
  },
  {
    name: "root TypeScript ESM webpack config refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "webpack.config.mts": 'export default {resolve:{alias:{react:"./absent.js"}}};',
    },
  },
  {
    name: "mere webpack dependency with ordinary CRA scripts remains eligible",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2", "webpack": "5.64.4", "react-scripts": "5.0.1"}, "scripts": {"build": "react-scripts build", "start": "react-scripts start"}, "resolutions": {"react-error-overlay": "6.0.9"}}',
    },
  },
  {
    name: "aliased promise with a later rejecting finally remains outside the certificate",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{const task=fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);task.finally(()=>{throw new Error("later")});},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {},
  },
  {
    name: "explicit Vite alias configuration refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "package.json": '{"dependencies": {"react": "17.0.2"}, "scripts": {"build": "vite build"}}',
      "vite.config.js": 'export default {resolve:{alias:{react:"./fake-react"}}};',
    },
  },
  {
    name: "configuration without a package script still refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "vite.config.ts": 'export default {resolve:{alias:{react:"./fake-react"}}};',
    },
  },
  {
    name: "CRA browser provider remap refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2", "react-scripts": "5.0.1"}, "scripts": {"build": "react-scripts build"}, "browser": {"react": "./fake-react"}}',
    },
  },
  {
    name: "provider package resolution override refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2"}, "resolutions": {"react": "npm:fake-react@17.0.2"}}',
    },
  },
  {
    name: "custom compiler invocation refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2"}, "scripts": {"build": "custom-compiler --react ./fake-react"}}',
    },
  },

  {
    name: "undeclared CRA command refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2"}, "scripts": {"build": "react-scripts build"}}',
    },
  },
  {
    name: "unsupported CRA major version refuses",
    source:
      'import {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: false,
    diagnostics: 1,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2", "react-scripts": "4.0.3"}, "scripts": {"build": "react-scripts build"}}',
    },
  },
  {
    name: "ordinary CRA style imports do not count as unindexed executable modules",
    source:
      'import "./surface.css";\nimport {useEffect,useState} from "react";\n\nexport const Panel=()=>{const [data,setData]=useState(null);useEffect(()=>{fetch("/data",{method:"GET"}).then(response=>response.json()).then(value=>setData(value)).catch(error=>error);},[]);return <output>{data?.name}</output>};\n',
    certificate: true,
    diagnostics: 0,
    files: {
      "package.json":
        '{"dependencies": {"react": "17.0.2", "react-scripts": "5.0.1"}, "scripts": {"build": "react-scripts build"}}',
      "surface.css": ".pane { color: red; }",
    },
  },
];

describe("native fetch JSON identity catches", () => {
  for (const testCase of cases)
    it(testCase.name, () => {
      const { filename } = createProject(testCase.source, testCase.files);
      const probe = runRule(certificateProbe, testCase.source, { filename });
      expect(probe.parseErrors).toEqual([]);
      expect(probe.diagnostics).toHaveLength(testCase.certificate ? 1 : 0);
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, testCase.source, {
        filename,
      });
      expect(result.parseErrors).toEqual([]);
      if (testCase.diagnostics !== null)
        expect(result.diagnostics).toHaveLength(testCase.diagnostics);
    });
  it("refuses fingerprinting before missing producer or config facts", () => {
    const testCase = cases.find((entry) => entry.name === "missing imported record");
    if (!testCase) throw new Error("missing fixture");
    const { filename } = createProject(testCase.source, {});
    expect(
      collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: testCase.source,
        ruleIds: [noPromiseThenSideEffectInEffectWithoutCatch.id],
      }),
    ).toBeNull();
  });
  it("rechecks producer appearance, mutation and newly added importer with the same AST", () => {
    const testCase = cases.find((entry) => entry.name === "closed imported string record");
    if (!testCase) throw new Error("missing fixture");
    const { directory, filename } = createProject(testCase.source, {});
    const parsed = parseFixture(testCase.source, { filename });
    const count = () =>
      runRuleOnParsedFixture(certificateProbe, testCase.source, parsed, { filename }).diagnostics
        .length;
    expect(count()).toBe(0);
    writeFile(directory, "endpoints.ts", testCase.files["endpoints.ts"]);
    resetLookups();
    expect(count()).toBe(1);
    writeFile(
      directory,
      "other.ts",
      'import endpoints from "./endpoints";endpoints.profile=unknown;',
    );
    resetLookups();
    expect(count()).toBe(0);
    fs.unlinkSync(path.join(directory, "other.ts"));
    resetLookups();
    expect(count()).toBe(1);
    writeFile(
      directory,
      "endpoints.ts",
      "const endpoints={profile:{toString(){throw reason}}};export default endpoints;",
    );
    resetLookups();
    expect(count()).toBe(0);
  });
  it("rechecks configuration creation with the same AST", () => {
    const testCase = cases[0];
    const { directory, filename } = createProject(testCase.source, {});
    const parsed = parseFixture(testCase.source, { filename });
    const count = () =>
      runRuleOnParsedFixture(certificateProbe, testCase.source, parsed, { filename }).diagnostics
        .length;
    expect(count()).toBe(1);
    writeFile(directory, "tsconfig.json", '{"compilerOptions":{"paths":{"react":["./missing"]}}}');
    resetLookups();
    expect(count()).toBe(0);
    fs.unlinkSync(path.join(directory, "tsconfig.json"));
    resetLookups();
    expect(count()).toBe(1);
  });
  it("refuses wrapped identity fingerprinting and rechecks producer and config facts", () => {
    const testCase = cases.find((entry) => entry.name === "closed imported string record");
    if (!testCase) throw new Error("missing fixture");
    const source = testCase.source.replace(
      ".catch(error=>error)",
      ".catch(((error)=>error) as (error:unknown)=>unknown)",
    );
    expect(source).not.toBe(testCase.source);
    const { directory, filename } = createProject(source, {});
    const parsed = parseFixture(source, { filename });
    expect(parsed.errors).toEqual([]);
    const probes = () =>
      collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: source,
        ruleIds: [noPromiseThenSideEffectInEffectWithoutCatch.id],
      });
    const count = () => {
      const result = runRuleOnParsedFixture(certificateProbe, source, parsed, { filename });
      expect(result.parseErrors).toEqual([]);
      return result.diagnostics.length;
    };
    expect(probes()).toBeNull();
    expect(count()).toBe(0);
    writeFile(directory, "endpoints.ts", testCase.files["endpoints.ts"]);
    resetLookups();
    expect(probes()).toBeNull();
    expect(count()).toBe(1);
    writeFile(
      directory,
      "endpoints.ts",
      "const endpoints={profile:{toString(){throw reason}}};export default endpoints;",
    );
    resetLookups();
    expect(probes()).toBeNull();
    expect(count()).toBe(0);
    writeFile(directory, "endpoints.ts", testCase.files["endpoints.ts"]);
    resetLookups();
    expect(count()).toBe(1);
    writeFile(directory, "tsconfig.json", '{"compilerOptions":{"paths":{"react":["./missing"]}}}');
    resetLookups();
    expect(probes()).toBeNull();
    expect(count()).toBe(0);
    fs.unlinkSync(path.join(directory, "tsconfig.json"));
    resetLookups();
    expect(count()).toBe(1);
  });
});
