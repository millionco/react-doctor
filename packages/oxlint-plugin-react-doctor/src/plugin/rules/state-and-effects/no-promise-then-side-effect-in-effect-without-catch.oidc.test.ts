import {
  PROVIDER_PROOF_SMALL_COMPONENT_COUNT,
  PROVIDER_PROOF_LARGE_COMPONENT_COUNT,
  PROVIDER_PROOF_MAX_GROWTH_RATIO,
} from "../../../test-utils/constants.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { isRejectableOidcUserManagerCall } from "../../utils/is-rejectable-oidc-user-manager-call.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "./no-promise-then-side-effect-in-effect-without-catch.js";

const certificateProbe: Rule = {
  id: "oidc-get-user-certificate-probe",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (isRejectableOidcUserManagerCall(node, context))
        context.report({ node, message: "native store getter" });
    },
  }),
};
const cases = [
  {
    name: "same-file native local storage",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: true,
    diagnostics: 1,
  },
  {
    name: "same-file native session storage",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.sessionStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: true,
    diagnostics: 1,
  },
  {
    name: "renamed SDK constructor imports",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager as Manager,WebStorageStateStore as Store} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new Store({store:window.localStorage})};\nconst manager=new Manager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: true,
    diagnostics: 1,
  },
  {
    name: "inline settings",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\n\nconst manager=new UserManager({userStore:new WebStorageStateStore({store:window.localStorage})});\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: true,
    diagnostics: 1,
  },
  {
    name: "ordinary provider method siblings",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconst enter=()=>manager.signinRedirect();const leave=()=>manager.signoutRedirect();\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: true,
    diagnostics: 1,
  },
  {
    name: "existing catch remains quiet",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser).catch(()=>setUser(null));},[]);return <output>{user?.name}</output>};',
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "native-shaped interface type unrelated",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\ninterface Account {name:string}\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: true,
    diagnostics: 1,
  },
  {
    name: "wrong SDK module",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "other-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "different SDK generation",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client-ts";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "type-only SDK constructor",
    source:
      'import {useEffect,useState} from "react";\nimport type {UserManager} from "oidc-client";import {WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "type-only store constructor",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,type WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "default SDK constructor",
    source:
      'import {useEffect,useState} from "react";\nimport UserManager,{WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "local constructor homonym",
    source:
      'import {useEffect,useState} from "react";\nimport {WebStorageStateStore} from "oidc-client";class UserManager {getUser(){return Promise.resolve(null)}}\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "constructor alias",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst Manager=UserManager;const manager=new Manager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "subclass",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nclass Manager extends UserManager{}const manager=new Manager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "custom store",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={userStore:{get:()=>Promise.resolve(null)}};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "unknown store factory",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={userStore:createStore()};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "custom storage object",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={userStore:new WebStorageStateStore({store:{getItem:()=>null}})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "unproven default settings",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\n\nconst manager=new UserManager();\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "store prefix transport",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={userStore:new WebStorageStateStore({store:window.localStorage,prefix:customPrefix})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "native storage shadow",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconst window={localStorage:{getItem:()=>null}};\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "native storage alias mutation",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconst store=window.localStorage;store.getItem=()=>null;\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "bare native storage mutation",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nlocalStorage.getItem=()=>null;\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "native storage replacement",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nwindow.localStorage={getItem:()=>null};\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "storage prototype override",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nStorage.prototype.getItem=()=>null;\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "second store constructor exposure",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconst other=new WebStorageStateStore({store:window.localStorage});other._store.getItem=()=>null;\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "settings spread",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={...base,userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "settings duplicate override",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={userStore:new WebStorageStateStore({store:window.localStorage}),userStore:customStore};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "settings accessor",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={get userStore(){return new WebStorageStateStore({store:window.localStorage})}};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "settings assignment",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nsettings.userStore=customStore;\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "settings escape",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconfigure(settings);\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "instance member override",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nmanager.getUser=()=>Promise.resolve(null);\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "instance prototype override",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nUserManager.prototype.getUser=()=>Promise.resolve(null);\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "instance accessor override",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nmanager.__defineGetter__("getUser",()=>()=>Promise.resolve(null));\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "instance escape",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconfigure(manager);\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "getter extraction",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconst getUser=manager.getUser;\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "instance binding write",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n({manager}=replacement);\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "optional instance access",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager?.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "optional getter call",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser?.().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "computed getter",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager["getUser"]().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "getter arguments",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser(1).then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "dynamic loader",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconst patch=()=>import("./patch");\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "direct eval",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconst patch=()=>eval("replaceStore()");\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "runtime TypeScript enum",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nenum Runtime {Value=replaceStore()}\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "runtime TypeScript parameter property",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nclass Runtime {constructor(public value=replaceStore()) {}}\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "Promise native override",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nPromise.resolve=()=>({then:()=>null});\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "JSON native override",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nJSON.parse=()=>null;\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "global alias escape",
    source:
      'import {useEffect,useState} from "react";\nimport {UserManager,WebStorageStateStore} from "oidc-client";\nconst settings={authority:"https://issuer.invalid",client_id:"example",userStore:new WebStorageStateStore({store:window.localStorage})};\nconst manager=new UserManager(settings);\nconst browser=window;\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 0,
  },
  {
    name: "generic fetch path retained",
    source:
      'import {useEffect,useState} from "react";\n\n\n\n\nexport const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{fetch("/account").then(setUser);},[]);return <output>{user?.name}</output>};',
    certificate: false,
    diagnostics: 1,
  },
];
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-oidc-get-user-"));
afterAll(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
const resetLookups = () => {
  __clearParseSourceFileCacheForTests();
  resetCrossFileExportCaches();
  resetModuleResolutionCaches();
  resetTsconfigAliasCaches();
};

describe("OIDC native storage promise initiators", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const probe = runRule(certificateProbe, testCase.source);
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, testCase.source);
      expect(probe.parseErrors).toEqual([]);
      expect(result.parseErrors).toEqual([]);
      expect(probe.diagnostics).toHaveLength(testCase.certificate ? 1 : 0);
      expect(result.diagnostics).toHaveLength(testCase.diagnostics);
    });
  }
  it("declines a host without a filename", () => {
    const result = runRule(certificateProbe, cases[0].source, { filename: undefined });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

const facadeSource = `import {UserManager,WebStorageStateStore} from "oidc-client";
const settings={userStore:new WebStorageStateStore({store:window.localStorage})};
export const manager=new UserManager(settings);
`;
const consumerSource = `import {useEffect,useState} from "react";
import {manager} from "./session";
export const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser)},[]);return <output>{user?.name}</output>};
`;

describe("OIDC direct exported facade", () => {
  for (const testCase of [
    { name: "direct facade", provider: facadeSource, consumer: consumerSource, count: 1 },
    {
      name: "provider method override",
      provider: facadeSource + "manager.getUser=()=>Promise.resolve(null);",
      consumer: consumerSource,
      count: 0,
    },
    {
      name: "consumer method override",
      provider: facadeSource,
      consumer: consumerSource + "manager.getUser=()=>Promise.resolve(null);",
      count: 0,
    },
    {
      name: "provider escape",
      provider: facadeSource + "configure(manager);",
      consumer: consumerSource,
      count: 0,
    },
    {
      name: "consumer escape",
      provider: facadeSource,
      consumer: consumerSource + "configure(manager);",
      count: 0,
    },
    {
      name: "custom store facade",
      provider: facadeSource.replace(
        "new WebStorageStateStore({store:window.localStorage})",
        "{get:()=>Promise.resolve(null)}",
      ),
      consumer: consumerSource,
      count: 0,
    },
    {
      name: "mutable facade",
      provider: facadeSource.replace("export const manager", "export let manager"),
      consumer: consumerSource,
      count: 0,
    },
    {
      name: "type-only facade import",
      provider: facadeSource,
      consumer: consumerSource.replace("import {manager}", "import type {manager}"),
      count: 0,
    },
  ]) {
    it(testCase.name, () => {
      const directory = fs.mkdtempSync(path.join(temporaryRoot, "facade-"));
      const filename = path.join(directory, "AccountPanel.tsx");
      fs.writeFileSync(path.join(directory, "session.ts"), testCase.provider);
      resetLookups();
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, testCase.consumer, {
        filename,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
  it("tracks provider content, alias configuration and negative SDK remaps", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "probes-"));
    const filename = path.join(directory, "AccountPanel.tsx");
    const provider = path.join(directory, "session.ts");
    const config = path.join(directory, "tsconfig.json");
    fs.writeFileSync(provider, facadeSource);
    fs.writeFileSync(
      config,
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@session": ["./session"], "oidc-client": ["./sdk"] },
        },
      }),
    );
    const source = consumerSource.replace('"./session"', '"@session"');
    resetLookups();
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: source,
      ruleIds: ["no-promise-then-side-effect-in-effect-without-catch"],
    });
    expect(trace?.contentPaths).toContain(provider);
    expect(trace?.contentPaths).toContain(config);
    expect(trace?.existencePaths).toContain(path.join(directory, "sdk.ts"));
    const before = runRule(noPromiseThenSideEffectInEffectWithoutCatch, source, { filename });
    expect(before.parseErrors).toEqual([]);
    expect(before.diagnostics).toHaveLength(1);
    fs.writeFileSync(path.join(directory, "sdk.ts"), "export class UserManager {};");
    resetLookups();
    const after = runRule(noPromiseThenSideEffectInEffectWithoutCatch, source, { filename });
    expect(after.parseErrors).toEqual([]);
    expect(after.diagnostics).toHaveLength(0);
  });
  it("declines a reexport rather than traversing a second facade", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "barrel-"));
    const filename = path.join(directory, "AccountPanel.tsx");
    fs.writeFileSync(path.join(directory, "session.ts"), 'export {manager} from "./actual";');
    fs.writeFileSync(path.join(directory, "actual.ts"), facadeSource);
    resetLookups();
    const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, consumerSource, {
      filename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

const strictSdkSource = `import {useEffect,useState} from "react";
import {UserManager,WebStorageStateStore} from "oidc-client";
const settings={userStore:new WebStorageStateStore({store:window.localStorage})};
const manager=new UserManager(settings);
export const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser)},[]);return <output>{user?.name}</output>};
`;

describe("OIDC SDK and native alias boundaries", () => {
  for (const testCase of [
    {
      name: "SDK User static parser replacement",
      extra: 'import {User} from "oidc-client"; User.fromStorageString=()=>({});',
      count: 0,
    },
    {
      name: "SDK secondary constructor prototype destructuring",
      extra:
        'import {UserManager as OtherManager} from "oidc-client"; const {prototype:methods}=OtherManager; methods.getUser=()=>Promise.resolve(null);',
      count: 0,
    },
    {
      name: "SDK secondary constructor escape",
      extra: 'import {UserManager as OtherManager} from "oidc-client"; configure(OtherManager);',
      count: 0,
    },
    {
      name: "SDK namespace exposure",
      extra: 'import * as sdk from "oidc-client"; sdk.User.fromStorageString=()=>({});',
      count: 0,
    },
    {
      name: "SDK default exposure",
      extra: 'import sdk from "oidc-client"; configure(sdk);',
      count: 0,
    },
    {
      name: "SDK extra runtime User read",
      extra: 'import {User} from "oidc-client"; const UserType=User;',
      count: 0,
    },
    {
      name: "SDK erased type-only uses preserved",
      extra:
        'import {User,Profile,UserManagerSettings} from "oidc-client"; interface Account {user:User;profile:Profile;settings:UserManagerSettings}',
      count: 1,
    },
    {
      name: "SDK explicit type-only use preserved",
      extra: 'import type {User} from "oidc-client"; interface Account {user:User}',
      count: 1,
    },
    {
      name: "SDK type-only runtime misuse",
      extra: 'import type {User} from "oidc-client"; User.fromStorageString=()=>({});',
      count: 0,
    },
    {
      name: "window JSON extraction",
      extra: "const parser=window.JSON; parser.parse=()=>({});",
      count: 0,
    },
    {
      name: "recursive window alias",
      extra: "const root=window.window; root.JSON.parse=()=>({});",
      count: 0,
    },
    {
      name: "recursive window destructuring",
      extra: "const {JSON:parser}=window.window; parser.parse=()=>({});",
      count: 0,
    },
    { name: "window decoder extraction", extra: "const decode=window.atob;", count: 0 },
    {
      name: "process non-environment transport",
      extra: "const root=process.mainModule;",
      count: 0,
    },
    {
      name: "window Promise extraction",
      extra:
        "const NativePromise=window.Promise; NativePromise.resolve=()=>({then:()=>NativePromise.all([])});",
      count: 0,
    },
    { name: "window JSON direct use", extra: 'window.JSON.parse("{}");', count: 0 },
    { name: "SDK runtime reexport", extra: 'export {User} from "oidc-client";', count: 0 },
    {
      name: "native original read roles preserved",
      extra:
        "const parse=(text)=>JSON.parse(window.atob(text)); const setting=process.env.EXAMPLE;",
      count: 1,
    },
  ]) {
    it(testCase.name, () => {
      const source = strictSdkSource + testCase.extra;
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
});

describe("OIDC resolved consumer import identities", () => {
  for (const testCase of [
    {
      name: "split same-source alias",
      imports: 'import {manager as alternate} from "./session";',
      mutation: "alternate.getUser=()=>Promise.resolve(null);",
      count: 0,
    },
    {
      name: "split explicit-extension alias",
      imports: 'import {manager as alternate} from "./session.ts";',
      mutation: "alternate.getUser=()=>Promise.resolve(null);",
      count: 0,
    },
    {
      name: "tsconfig alias",
      imports: 'import {manager as alternate} from "@session";',
      mutation: "alternate.getUser=()=>Promise.resolve(null);",
      count: 0,
    },
    {
      name: "renamed barrel alias",
      imports: 'import {renamed as alternate} from "./barrel";',
      mutation: "alternate.getUser=()=>Promise.resolve(null);",
      count: 0,
    },
    {
      name: "namespace immediate facade",
      imports: 'import * as facade from "./session";',
      mutation: "facade.manager.getUser=()=>Promise.resolve(null);",
      count: 0,
    },
    {
      name: "namespace renamed barrel",
      imports: 'import * as facade from "./barrel";',
      mutation: "facade.renamed.getUser=()=>Promise.resolve(null);",
      count: 0,
    },
    {
      name: "default barrel alias",
      imports: 'import alternate from "./default-facade";',
      mutation: "alternate.getUser=()=>Promise.resolve(null);",
      count: 0,
    },
    {
      name: "consumer SDK parser exposure",
      imports: 'import {User} from "oidc-client";',
      mutation: "User.fromStorageString=()=>({});",
      count: 0,
    },
    {
      name: "other facade values remain supported",
      imports: 'import {settings as displaySettings,enter} from "./session";',
      mutation: "const authority=displaySettings.authority; const begin=()=>enter();",
      count: 1,
    },
    {
      name: "erased facade import remains supported",
      imports: 'import type {manager as alternate} from "./session";',
      mutation: "type Manager=typeof alternate;",
      count: 1,
    },
  ]) {
    it(testCase.name, () => {
      const directory = fs.mkdtempSync(path.join(temporaryRoot, "consumer-identities-"));
      const filename = path.join(directory, "AccountPanel.tsx");
      const provider =
        facadeSource.replace("const settings", "export const settings") +
        "export const enter=()=>manager.signinRedirect();";
      fs.writeFileSync(path.join(directory, "session.ts"), provider);
      fs.writeFileSync(
        path.join(directory, "barrel.ts"),
        'export {manager as renamed} from "./session";',
      );
      fs.writeFileSync(
        path.join(directory, "default-facade.ts"),
        'export {manager as default} from "./session";',
      );
      fs.writeFileSync(
        path.join(directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@session": ["./session"] } } }),
      );
      const source = consumerSource + testCase.imports + testCase.mutation;
      resetLookups();
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, source, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
  it("collects a secondary alias barrel and its configuration before declining", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "alias-probes-"));
    const filename = path.join(directory, "AccountPanel.tsx");
    const provider = path.join(directory, "session.ts");
    const barrel = path.join(directory, "barrel.ts");
    const config = path.join(directory, "tsconfig.json");
    fs.writeFileSync(provider, facadeSource);
    fs.writeFileSync(barrel, 'export {manager as renamed} from "./session";');
    fs.writeFileSync(
      config,
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@barrel": ["./barrel"] } } }),
    );
    const source =
      consumerSource + 'import {renamed} from "@barrel"; const readAlias=()=>renamed.getUser();';
    resetLookups();
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: source,
      ruleIds: ["no-promise-then-side-effect-in-effect-without-catch"],
    });
    expect(trace?.contentPaths).toContain(provider);
    expect(trace?.contentPaths).toContain(barrel);
    expect(trace?.contentPaths).toContain(config);
  });
});

describe("OIDC constructing-module runtime import boundary", () => {
  for (const testCase of [
    {
      name: "provider direct self import",
      path: "./session",
      body: 'export {manager as alternate} from "./session";',
      count: 0,
    },
    {
      name: "provider renamed barrel import",
      path: "./bridge",
      body: 'export {manager as alternate} from "./session";',
      count: 0,
    },
  ]) {
    it(testCase.name, () => {
      const directory = fs.mkdtempSync(path.join(temporaryRoot, "provider-import-"));
      const filename = path.join(directory, "AccountPanel.tsx");
      const importedName = testCase.path === "./session" ? "manager" : "alternate";
      const provider =
        facadeSource +
        `import {${importedName} as secondary} from "${testCase.path}"; secondary.getUser=()=>Promise.resolve(null);`;
      fs.writeFileSync(path.join(directory, "session.ts"), provider);
      fs.writeFileSync(path.join(directory, "bridge.ts"), testCase.body);
      resetLookups();
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, consumerSource, {
        filename,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }

  it("declines a local construction importing its own exported instance", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "local-self-import-"));
    const filename = path.join(directory, "AccountPanel.tsx");
    const source =
      strictSdkSource.replace("const manager=", "export const manager=") +
      'import {manager as alternate} from "./AccountPanel"; alternate.getUser=()=>Promise.resolve(null);';
    fs.writeFileSync(filename, source);
    resetLookups();
    const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves direct local construction with genuine React and SDK imports", () => {
    const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, strictSdkSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves an unrelated erased UserInfo import in a TypeScript provider", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "erased-provider-import-"));
    const filename = path.join(directory, "AccountPanel.tsx");
    const provider =
      facadeSource + 'import {UserInfo} from "./types"; interface Account {user:UserInfo}';
    fs.writeFileSync(path.join(directory, "session.ts"), provider);
    fs.writeFileSync(path.join(directory, "types.ts"), "export interface UserInfo {name:string}");
    resetLookups();
    const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, consumerSource, {
      filename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("declines an opaque runtime provider import and a side-effect import", () => {
    for (const imported of [
      'import {patch} from "./patch"; patch();',
      'import {patch} from "./patch";',
      'import "./patch";',
    ]) {
      const directory = fs.mkdtempSync(path.join(temporaryRoot, "opaque-provider-import-"));
      const filename = path.join(directory, "AccountPanel.tsx");
      fs.writeFileSync(path.join(directory, "session.ts"), facadeSource + imported);
      fs.writeFileSync(path.join(directory, "patch.ts"), "export const patch=()=>undefined;");
      resetLookups();
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, consumerSource, {
        filename,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });
});

describe("OIDC erased provider import identity", () => {
  for (const testCase of [
    {
      name: "module interface heritage",
      declaration: "interface Account extends UserInfo {}",
      diagnostics: 1,
    },
    {
      name: "module interface field",
      declaration: "interface Account {user:UserInfo}",
      diagnostics: 1,
    },
    {
      name: "exported interface heritage",
      declaration: "export interface Account extends UserInfo {}",
      diagnostics: 1,
    },
    {
      name: "exported interface field",
      declaration: "export interface Account {user:UserInfo}",
      diagnostics: 1,
    },
    {
      name: "unused value import",
      declaration: "interface Account {name:string}",
      diagnostics: 0,
    },
    {
      name: "generic interface shadows import",
      declaration: "interface Account<UserInfo> {user:UserInfo}",
      diagnostics: 0,
    },
    {
      name: "generic method shadows import",
      declaration: "interface Account {read<UserInfo>():UserInfo}",
      diagnostics: 0,
    },
    {
      name: "generic callable property shadows import",
      declaration: "interface Account {read:<UserInfo>()=>UserInfo}",
      diagnostics: 0,
    },
    {
      name: "local interface shadows import",
      declaration: "const describe=(UserInfo)=>{interface Account {user:UserInfo}};",
      diagnostics: 0,
    },
    {
      name: "unrelated property key spelling",
      declaration: "interface Account {UserInfo:string}",
      diagnostics: 0,
    },
    {
      name: "computed property spelling",
      declaration: "interface Account {[UserInfo]:string}",
      diagnostics: 0,
    },
    {
      name: "qualified name is outside V1",
      declaration: "interface Account {user:UserInfo.Detail}",
      diagnostics: 0,
    },
  ]) {
    it(testCase.name, () => {
      const directory = fs.mkdtempSync(path.join(temporaryRoot, "erased-provider-identity-"));
      const filename = path.join(directory, "AccountPanel.tsx");
      fs.writeFileSync(
        path.join(directory, "session.ts"),
        facadeSource + 'import {UserInfo} from "./types";' + testCase.declaration,
      );
      fs.writeFileSync(path.join(directory, "types.ts"), "export interface UserInfo {name:string}");
      resetLookups();
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, consumerSource, {
        filename,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.diagnostics);
    });
  }
});

describe("program provider proof growth", () => {
  it("checks stable provider imports once as sibling components grow", () => {
    const results = [
      PROVIDER_PROOF_SMALL_COMPONENT_COUNT,
      PROVIDER_PROOF_LARGE_COMPONENT_COUNT,
    ].map((size) => {
      const source =
        'import {useState,useEffect} from "react"; import {UserManager,WebStorageStateStore} from "oidc-client";const settings={userStore:new WebStorageStateStore({store:window.localStorage})};const manager=new UserManager(settings);' +
        Array.from(
          { length: size },
          (_, index) =>
            `export const Panel${index}=()=>{const[user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser);},[]);return <output>{user?.name}</output>}`,
        ).join("\n");
      let symbolVisits = 0;
      const measuredRule = {
        ...noPromiseThenSideEffectInEffectWithoutCatch,
        create: (
          context: Parameters<typeof noPromiseThenSideEffectInEffectWithoutCatch.create>[0],
        ) => {
          const symbols = new Proxy(context.scopes.rootScope.symbols, {
            get: (target, property, receiver) => {
              if (typeof property === "string" && /^\d+$/.test(property)) symbolVisits += 1;
              return Reflect.get(target, property, receiver);
            },
          });
          const rootScope = new Proxy(context.scopes.rootScope, {
            get: (target, property, receiver) =>
              property === "symbols" ? symbols : Reflect.get(target, property, receiver),
          });
          const scopes = new Proxy(context.scopes, {
            get: (target, property, receiver) =>
              property === "rootScope" ? rootScope : Reflect.get(target, property, receiver),
          });
          return noPromiseThenSideEffectInEffectWithoutCatch.create({ ...context, scopes });
        },
      };
      const result = runRule(measuredRule, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(size);
      return symbolVisits;
    });
    expect(results[0]).toBeGreaterThan(0);
    expect(results[1]).toBeLessThanOrEqual(results[0] * PROVIDER_PROOF_MAX_GROWTH_RATIO);
  });
});

describe("memoized OIDC provider dependencies", () => {
  it("replays warm probes and refreshes the same analysis after a filesystem epoch", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "memo-probes-"));
    const filename = path.join(directory, "AccountPanel.tsx");
    const provider = path.join(directory, "session.ts");
    fs.writeFileSync(provider, facadeSource);
    let exercised = false;
    const probe: Rule = {
      id: "oidc-memo-dependency-probe",
      severity: "warn",
      create: (context) => ({
        CallExpression: (node) => {
          const cold = captureCrossFileProbes(() => isRejectableOidcUserManagerCall(node, context));
          if (!cold.value) return;
          exercised = true;
          const warm = captureCrossFileProbes(() => isRejectableOidcUserManagerCall(node, context));
          expect(warm.value).toBe(true);
          expect([...warm.trace.contentPaths].sort()).toEqual([...cold.trace.contentPaths].sort());
          expect([...warm.trace.existencePaths].sort()).toEqual(
            [...cold.trace.existencePaths].sort(),
          );
          expect(cold.trace.contentPaths.has(provider)).toBe(true);
          fs.writeFileSync(provider, facadeSource.replace("window.localStorage", "customStorage"));
          resetFilesystemCaches();
          expect(isRejectableOidcUserManagerCall(node, context)).toBe(false);
        },
      }),
    };
    const result = runRule(probe, consumerSource, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(exercised).toBe(true);
  });
});
