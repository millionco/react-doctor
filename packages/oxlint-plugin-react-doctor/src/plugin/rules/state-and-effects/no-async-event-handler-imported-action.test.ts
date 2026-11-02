import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

interface ImportedActionFixtureOptions {
  readonly handler?: string;
  readonly handlerDependencies?: string;
  readonly actionDependencies?: string;
  readonly parentGate?: string;
  readonly jsx?: string;
  readonly parameter?: string;
  readonly destructure?: string;
  readonly requestForwarder?: string;
  readonly closeCallback?: string;
  readonly requestMethod?: string;
  readonly requestPath?: string;
  readonly configured?: boolean;
  readonly storeArgument?: string;
  readonly atomArguments?: string;
  readonly providerPrefix?: string;
  readonly componentPrefix?: string;
}

let temporaryDirectory: string;
const ruleId = "no-async-event-handler-without-reentry-guard";
const message =
  "This async handler awaits a mutating request and only flips state after the await, so a fast double-click or double Enter fires the request twice. Add a leading `if (busy) return` guard (or set a flag before the await and disable the control) to close the re-entry window.";

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-imported-action-"));
  resetFilesystemCaches();
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const writeFixture = (options: ImportedActionFixtureOptions = {}): string => {
  const write = (name: string, source: string): void =>
    fs.writeFileSync(path.join(temporaryDirectory, name), source);
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@network": ["./network.ts"] } } }),
  );
  write(
    "network.ts",
    `import client from '${options.configured ? "./client" : "axios"}';
import join from 'url-join';
export async function request(verb, endpoint, body) { const response = await client[verb](join('/v2', endpoint), body); return response.data; }
${options.requestForwarder ?? `export async function send(endpoint, body = {}) { return request('${options.requestMethod ?? "post"}', ${options.requestPath ?? "endpoint"}, body); }`}
`,
  );
  write(
    "client.ts",
    `import axios from 'axios';import {makeClient} from './factory';const client=Object.assign({},axios,makeClient(),{create:makeClient});export default client;`,
  );
  write(
    "factory.ts",
    `import axios from 'axios';import qs from 'qs';import {formatISO} from 'date-fns/formatISO';import {revive} from './response';
export const makeClient=(options?)=>{
const transforms=axios.defaults.transformResponse==null?[]:Array.isArray(axios.defaults.transformResponse)?axios.defaults.transformResponse:[axios.defaults.transformResponse];
const client=axios.create({...options,headers:{'Content-Type':'application/json'},transformResponse:transforms.concat(value=>revive(value))});
client.interceptors.request.use(config=>{config.paramsSerializer=values=>qs.stringify(values,{serializeDate:date=>formatISO(date,{representation:'date'})});return config});
return client;
};`,
  );
  write("response.ts", "export const revive=value=>value;");
  write(
    "panel-state.ts",
    `import {useCallback} from 'react';import {atom,useAtomValue,useSetAtom} from 'jotai';
${options.providerPrefix ?? ""}
const panelAtom=atom(${options.atomArguments ?? "{open:false,entries:[]}"});
export const usePanelStatus=()=>useAtomValue(panelAtom);
export const usePanelActions=()=>{const writePanel=useSetAtom(panelAtom${options.storeArgument ?? ""});const close=useCallback(${options.closeCallback ?? "()=>{writePanel({open:false,entries:[]})}"},${options.actionDependencies ?? "[writePanel]"});return {close}};
`,
  );
  const source = `import {useCallback} from 'react';import {send} from '@network';import {usePanelStatus,usePanelActions} from './panel-state';
${options.componentPrefix ?? ""}
const Dialog=(${options.parameter ?? "{dismiss}"})=>{
${options.destructure ?? ""}
const submit=useCallback(async()=>{${options.handler ?? "await send('/records.save',{});dismiss();"}},${options.handlerDependencies ?? "[dismiss]"});
return ${options.jsx ?? "<button onClick={submit}/>"};
};
export const Screen=()=>{const status=usePanelStatus();const {close}=usePanelActions();${options.parentGate ?? "if(!status?.open)return null;return <Dialog dismiss={close}/>;"}};
`;
  write("Screen.tsx", source);
  return source;
};

const runFixture = (source: string) =>
  runRule(noAsyncEventHandlerWithoutReentryGuard, source, {
    filename: path.join(temporaryDirectory, "Screen.tsx"),
  });

const expectFinding = (source: string): void => {
  const actual = runFixture(source);
  expect(actual.parseErrors).toEqual([]);
  expect(actual.diagnostics).toEqual([{ nodeType: "AwaitExpression", message }]);
};

const expectNoFinding = (source: string): void => {
  const actual = runFixture(source);
  expect(actual.parseErrors).toEqual([]);
  expect(actual.diagnostics).toEqual([]);
};

describe("imported request and same-store visibility action", () => {
  it("declines a visible CommonJS provider replacement", () =>
    expectNoFinding(
      writeFixture({ componentPrefix: "module['require']('axios').post=async()=>({data:null});" }),
    ));
  it("preserves inert CommonJS names", () =>
    expectFinding(
      writeFixture({
        componentPrefix:
          "const labels={module:'description',exports:'description',require:'description'}; interface module {} interface exports {}",
      }),
    ));

  it("keeps type-only exports outside the runtime closure", () =>
    expectFinding(writeFixture({ componentPrefix: "export type {Dialog,useCallback};" })));

  it("declines an explicitly custom JSX factory", () =>
    expectNoFinding(writeFixture({ componentPrefix: "/** @jsx jsx */\nconst jsx=()=>null;" })));
  it("preserves an incidental JSX pragma string", () =>
    expectFinding(writeFixture({ componentPrefix: "const description='@jsx jsx';" })));

  it.each([
    ["erased-hook", { componentPrefix: "interface useCallback {}" }],
    ["erased-component", { componentPrefix: "interface Dialog {}" }],
    [
      "erased-provider-pattern",
      { providerPrefix: "type Notes=({Function}:{Function:string})=>void;" },
    ],
    [
      "inert-provider-keys",
      { providerPrefix: "const labels={Function:'description',constructor:'description'};" },
    ],
  ])("retains imported evidence beside %s", (_name, options) =>
    expectFinding(writeFixture(options)),
  );

  it("declines a request default that claims reentry before forwarding", () =>
    expectNoFinding(
      writeFixture({
        requestForwarder:
          "let claimed=false;const claimOnce=()=>{if(claimed)throw new Error('already running');claimed=true;return {}};export const send=(endpoint,body=claimOnce())=>request('post',endpoint,body);",
        handler: "await send('/records.save',undefined);dismiss();",
      }),
    ));
  it("declines an async single-return wrapper whose default claims reentry", () =>
    expectNoFinding(
      writeFixture({
        requestForwarder:
          "let claimed=false;const claimOnce=()=>{if(claimed)throw new Error('already running');claimed=true;return {}};export async function send(endpoint,body=claimOnce()){return request('post',endpoint,body);}",
        handler: "await send('/records.save',undefined);dismiss();",
      }),
    ));
  it("declines an effectful method default even when its actual argument is supplied", () =>
    expectNoFinding(
      writeFixture({
        requestForwarder:
          "const chooseMethod=()=>{recordAttempt();return 'post'};export const send=(endpoint,body,method=chooseMethod())=>request(method,endpoint,body);",
        handler: "await send('/records.save',{},'post');dismiss();",
      }),
    ));
  it.each(["null", "'fallback'", "false", "0", "{}", "[]"])(
    "preserves inert request defaults: %s",
    (defaultValue) =>
      expectFinding(
        writeFixture({
          requestForwarder: `export const send=(endpoint,body=${defaultValue})=>request('post',endpoint,body);`,
        }),
      ),
  );
  it.each(["/token/", "1n", "{value:recordAttempt()}", "[recordAttempt()]"])(
    "declines a nonpermitted request default: %s",
    (defaultValue) =>
      expectNoFinding(
        writeFixture({
          requestForwarder: `export const send=(endpoint,body=${defaultValue})=>request('post',endpoint,body);`,
        }),
      ),
  );
  it.each([
    [
      "a synchronous concise wrapper",
      "export const send=(endpoint,body={})=>request('post',endpoint,body);",
    ],
    [
      "a synchronous single-return wrapper",
      "export function send(endpoint,body={}){return request('post',endpoint,body);}",
    ],
  ])("follows %s without accepting additional effects", (_name, requestForwarder) =>
    expectFinding(writeFixture({ requestForwarder })),
  );
  it("accepts initially open primitive state when current visibility gates the child", () =>
    expectFinding(writeFixture({ atomArguments: "{open:true,entries:[]}" })));
  it("follows a synchronous concise close callback with the same setter dependency", () =>
    expectFinding(writeFixture({ closeCallback: "()=>writePanel({open:false,entries:[]})" })));
  it("combines synchronous forwarding, initially open state and a concise close callback", () =>
    expectFinding(
      writeFixture({
        requestForwarder: "export const send=(endpoint,body={})=>request('post',endpoint,body);",
        atomArguments: "{open:true,entries:[]}",
        closeCallback: "()=>writePanel({open:false,entries:[]})",
        parentGate: "return status.open?<Dialog dismiss={close}/>:null;",
      }),
    ));
  it.each([
    "export function send(endpoint,body={}){recordAttempt();return request('post',endpoint,body);}",
    "export const send=(endpoint,body={})=>(recordAttempt(),request('post',endpoint,body));",
  ])("declines a synchronous forwarder with an extra effect: %s", (requestForwarder) =>
    expectNoFinding(writeFixture({ requestForwarder })),
  );
  it("declines a nonboolean initial visibility property", () =>
    expectNoFinding(writeFixture({ atomArguments: "{open:'shown',entries:[]}" })));
  it.each([
    "()=>{recordClose();writePanel({open:false,entries:[]})}",
    "()=>(recordClose(),writePanel({open:false,entries:[]}))",
    "async()=>writePanel({open:false,entries:[]})",
  ])("declines an effectful or asynchronous close callback: %s", (closeCallback) =>
    expectNoFinding(writeFixture({ closeCallback })),
  );
  it("follows a canonical client wrapper and a leading parent visibility exit", () =>
    expectFinding(writeFixture()));
  it("follows the bounded configured client and props-object destructuring", () =>
    expectFinding(
      writeFixture({ configured: true, parameter: "props", destructure: "const {dismiss}=props;" }),
    ));
  it("accepts single-return blocks in configured response and date serialization callbacks", () => {
    const source = writeFixture({ configured: true });
    const filename = path.join(temporaryDirectory, "factory.ts");
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, "utf8")
        .replace("value=>revive(value)", "value=>{return revive(value);}")
        .replace(
          "date=>formatISO(date,{representation:'date'})",
          "(date:Date)=>{return formatISO(date,{representation:'date'});}",
        ),
    );
    expectFinding(source);
  });
  it("declines extra statements in a configured date serialization callback", () => {
    const source = writeFixture({ configured: true });
    const filename = path.join(temporaryDirectory, "factory.ts");
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, "utf8")
        .replace(
          "date=>formatISO(date,{representation:'date'})",
          "date=>{const marker=0;return formatISO(date,{representation:'date'});}",
        ),
    );
    expectNoFinding(source);
  });
  it("accepts the conditional parent visibility render without a child status prop", () =>
    expectFinding(
      writeFixture({ parentGate: "return status.open?<Dialog dismiss={close}/>:null;" }),
    ));
  it("accepts extra live handler dependencies", () =>
    expectFinding(writeFixture({ handlerDependencies: "[dismiss,otherValue]" })));
  it("keeps the leading busy-return guard", () =>
    expectNoFinding(
      writeFixture({ handler: "if(busy)return;await send('/records.save',{});dismiss();" }),
    ));
  it("declines a read request", () => expectNoFinding(writeFixture({ requestMethod: "get" })));
  it("declines a wrapper that substitutes a nonmutating endpoint", () =>
    expectNoFinding(writeFixture({ requestPath: "'/preview'" })));
  it("declines a stale provider callback", () =>
    expectNoFinding(writeFixture({ actionDependencies: "[]" })));
  it("declines a stale memoized handler even when the provider callback is fresh", () =>
    expectNoFinding(writeFixture({ handlerDependencies: "[]" })));
  it("declines an explicit store option", () =>
    expectNoFinding(writeFixture({ storeArgument: ",{store:otherStore}" })));
  it("declines a custom writable atom", () =>
    expectNoFinding(writeFixture({ atomArguments: "{open:false},(get,set,value)=>{}" })));
  it("declines a status that does not gate this child", () =>
    expectNoFinding(writeFixture({ parentGate: "return <Dialog dismiss={close}/>;" })));
  it("preserves the throw before a late action", () =>
    expectNoFinding(
      writeFixture({
        handler: "await send('/records.save',{});throw new Error('stop');dismiss();",
      }),
    ));
  it("preserves exclusive request and action branches", () =>
    expectNoFinding(
      writeFixture({ handler: "if(choice){await send('/records.save',{})}else{dismiss()}" }),
    ));
  it("keeps custom host transport outside the finite profile", () =>
    expectNoFinding(writeFixture({ jsx: "<Control onClick={submit}/>" })));
  it("declines an authoritative prop hidden by a later spread", () =>
    expectNoFinding(
      writeFixture({
        parentGate: "return status.open?<Dialog dismiss={close} {...otherProps}/>:null;",
      }),
    ));
  it("declines a writable selected prop", () =>
    expectNoFinding(
      writeFixture({ handler: "dismiss=other;await send('/records.save',{});dismiss();" }),
    ));
  it("declines an erased declaration masking a missing catch reference", () =>
    expectNoFinding(
      writeFixture({ handler: "try{await send('/records.save',{})}catch(dismiss){dismiss()}" }),
    ));
  it("declines a destructured prop default", () =>
    expectNoFinding(writeFixture({ parameter: "{dismiss=other}" })));
  it("declines a leaked private component", () =>
    expectNoFinding(
      writeFixture({
        parentGate: "consume(Dialog);return status.open?<Dialog dismiss={close}/>:null;",
      }),
    ));
  it("declines a visible facade method override", () => {
    const source = writeFixture({ configured: true });
    const filename = path.join(temporaryDirectory, "client.ts");
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, "utf8")
        .replace("{create:makeClient}", "{post:other,create:makeClient}"),
    );
    expectNoFinding(source);
  });
  it("records every bounded provider and alias configuration and replays the same probes", () => {
    const source = writeFixture({ configured: true });
    const filename = path.join(temporaryDirectory, "Screen.tsx");
    const collect = () =>
      collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: source,
        ruleIds: [ruleId],
      });
    const first = collect();
    const second = collect();
    for (const provider of [
      "network.ts",
      "client.ts",
      "factory.ts",
      "panel-state.ts",
      "tsconfig.json",
    ])
      expect(first?.contentPaths.has(path.join(temporaryDirectory, provider))).toBe(true);
    expect([...(second?.contentPaths ?? [])].sort()).toEqual(
      [...(first?.contentPaths ?? [])].sort(),
    );
    expect([...(second?.existencePaths ?? [])].sort()).toEqual(
      [...(first?.existencePaths ?? [])].sort(),
    );
  });
  it("notices delete and appearance across documented filesystem reset boundaries", () => {
    const source = writeFixture();
    const filename = path.join(temporaryDirectory, "network.ts");
    const provider = fs.readFileSync(filename, "utf8");
    expectFinding(source);
    fs.unlinkSync(filename);
    resetFilesystemCaches();
    expectNoFinding(source);
    fs.writeFileSync(filename, provider);
    resetFilesystemCaches();
    expectFinding(source);
  });
  it("notices equal-size provider changes after an explicit cache epoch reset", () => {
    const source = writeFixture();
    const filename = path.join(temporaryDirectory, "network.ts");
    const original = fs.readFileSync(filename, "utf8");
    const changed = original.replace("'post'", "'get '");
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));
    const timestamp = fs.statSync(filename);
    expectFinding(source);
    fs.writeFileSync(filename, changed);
    fs.utimesSync(filename, timestamp.atime, timestamp.mtime);
    resetFilesystemCaches();
    expectNoFinding(source);
  });
  it("declines canonical interceptor registration", () => {
    const source = writeFixture();
    const filename = path.join(temporaryDirectory, "network.ts");
    fs.appendFileSync(filename, "client.interceptors.request.use(config=>config);\n");
    expectNoFinding(source);
  });
  it("declines a request config argument", () => {
    const source = writeFixture();
    const filename = path.join(temporaryDirectory, "network.ts");
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, "utf8")
        .replace("endpoint), body)", "endpoint), body, {adapter:other})"),
    );
    expectNoFinding(source);
  });
  it("declines a directly exported atom", () => {
    const source = writeFixture();
    const filename = path.join(temporaryDirectory, "panel-state.ts");
    fs.writeFileSync(
      filename,
      fs.readFileSync(filename, "utf8").replace("const panelAtom=", "export const panelAtom="),
    );
    expectNoFinding(source);
  });
  it("declines parent hooks evaluated outside this parent invocation", () => {
    const source = writeFixture({
      componentPrefix: "const status=usePanelStatus();const {close}=usePanelActions();",
    }).replace(
      "export const Screen=()=>{const status=usePanelStatus();const {close}=usePanelActions();",
      "export const Screen=()=>{",
    );
    expectNoFinding(source);
  });
  it("declines an empty handler dependency array behind a transparent wrapper", () => {
    const source = writeFixture({ handlerDependencies: "[]" }).replace(
      "},[]);",
      "},[]) as unknown;",
    );
    expectNoFinding(source);
  });
  it("declines configured-client interceptor registration outside the factory", () => {
    const source = writeFixture({ configured: true });
    fs.appendFileSync(
      path.join(temporaryDirectory, "network.ts"),
      "client.interceptors.request.use(config=>config);\n",
    );
    expectNoFinding(source);
  });

  it("does not broaden imported requests to ordinary local state setters", () => {
    writeFixture();
    const source = `import {useState} from 'react';import {send} from '@network';export const Screen=()=>{const[,setSaved]=useState(false);const submit=async()=>{await send('/records.save',{});setSaved(true)};return <button onClick={submit}/>};`;
    expectNoFinding(source);
  });

  it("declines a later duplicate visibility property in the close record", () => {
    const source = writeFixture();
    const filename = path.join(temporaryDirectory, "panel-state.ts");
    fs.writeFileSync(
      filename,
      fs
        .readFileSync(filename, "utf8")
        .replace(
          "writePanel({open:false,entries:[]})",
          "writePanel({open:false,open:true,entries:[]})",
        ),
    );
    expectNoFinding(source);
  });

  it("declines a Jotai namespace passed to a property mutation helper", () => {
    const source = writeFixture();
    const filename = path.join(temporaryDirectory, "panel-state.ts");
    const provider = fs
      .readFileSync(filename, "utf8")
      .replace(
        "import {atom,useAtomValue,useSetAtom} from 'jotai';",
        "import * as Jotai from 'jotai';Object.assign(Jotai,{useSetAtom:()=>()=>{}});",
      );
    fs.writeFileSync(
      filename,
      provider.replace(/\b(atom|useAtomValue|useSetAtom)\(/gu, "Jotai.$1("),
    );
    expectNoFinding(source);
  });

  it("declines a props object passed to a mutation helper before destructuring", () =>
    expectNoFinding(
      writeFixture({
        parameter: "props",
        destructure: "Object.assign(props,{dismiss:()=>{}});const {dismiss}=props;",
      }),
    ));

  it("declines a destructuring assignment into the props object", () =>
    expectNoFinding(
      writeFixture({
        parameter: "props",
        destructure: "({value:props.dismiss}={value:()=>{}});const {dismiss}=props;",
      }),
    ));

  it.each([
    { filename: "client.ts", prefix: "Object.assign=()=>({post:()=>Promise.resolve({data:{}})});" },
    {
      filename: "client.ts",
      prefix:
        "try{throw {}}catch({value=(Object.assign=()=>({post:()=>Promise.resolve({data:{}})}))}){}",
    },
    { filename: "client.ts", prefix: "replaceIntrinsic(Object);" },
    { filename: "factory.ts", prefix: "Array.isArray=()=>true;" },
    { filename: "factory.ts", prefix: "[].__proto__.concat=()=>{throw new Error('stop')};" },
    {
      filename: "factory.ts",
      prefix: "Object.getPrototypeOf([]).concat=()=>{throw new Error('stop')};",
    },
  ])("declines visible intrinsic replacement through $prefix", ({ filename, prefix }) => {
    const source = writeFixture({ configured: true });
    const provider = path.join(temporaryDirectory, filename);
    fs.writeFileSync(provider, `${prefix}\n${fs.readFileSync(provider, "utf8")}`);
    expectNoFinding(source);
  });

  it.each([
    { label: "disabled host", jsx: "<button disabled onClick={submit}/>" },
    {
      label: "disabled false remains outside the presence-only profile",
      jsx: "<button disabled={false} onClick={submit}/>",
    },
    { label: "inert host", jsx: "<button inert onClick={submit}/>" },
    { label: "hidden host", jsx: "<button hidden onClick={submit}/>" },
    { label: "aria-disabled host", jsx: "<button aria-disabled={false} onClick={submit}/>" },
    { label: "disabled ancestor", jsx: "<fieldset disabled><button onClick={submit}/></fieldset>" },
    { label: "inert ancestor", jsx: "<div inert><button onClick={submit}/></div>" },
    { label: "hidden ancestor", jsx: "<div hidden><button onClick={submit}/></div>" },
    {
      label: "aria-disabled ancestor",
      jsx: "<section aria-disabled><button onClick={submit}/></section>",
    },
    { label: "earlier selected-host spread", jsx: "<button {...otherProps} onClick={submit}/>" },
    { label: "later selected-host spread", jsx: "<button onClick={submit} {...otherProps}/>" },
    { label: "later duplicate event", jsx: "<button onClick={submit} onClick={other}/>" },
    { label: "earlier duplicate event", jsx: "<button onClick={other} onClick={submit}/>" },
    {
      label: "first inactive use of a shared handler",
      jsx: "<><button disabled onClick={submit}/><button onClick={submit}/></>",
    },
  ])("declines NEW imported evidence for $label", ({ jsx }) =>
    expectNoFinding(writeFixture({ jsx })),
  );

  it("keeps an ordinary host eligible through unrelated ancestor attributes", () =>
    expectFinding(
      writeFixture({
        jsx: '<section data-state="ready"><button type="button" onClick={submit}/></section>',
      }),
    ));

  it.each([
    { label: "disabled host", jsx: "<button disabled onClick={submit}/>" },
    { label: "later spread", jsx: "<button onClick={submit} {...otherProps}/>" },
    { label: "later duplicate", jsx: "<button onClick={submit} onClick={other}/>" },
  ])("preserves OLD direct request and setter analysis for $label", ({ jsx }) =>
    expectFinding(
      writeFixture({
        componentPrefix: "import {useState} from 'react';",
        destructure: "const [,setSaved]=useState(false);",
        handler: "await client.post('/records.save',{});setSaved(true);",
        handlerDependencies: "[]",
        jsx,
      }),
    ),
  );
});
