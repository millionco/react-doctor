import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const cases = [
  {
    name: "static-vite-env",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "static-vite-env.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "missing-capability-bag",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "missing-capability-bag.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
        },
      },
    },
    expected: 1,
  },
  {
    name: "react-only-host",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "react-only-host.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "non-vite-framework",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "non-vite-framework.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: ["react", "react:18", "nextjs"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "malformed-capabilities",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "malformed-capabilities.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: "vite",
        },
      },
    },
    expected: 1,
  },
  {
    name: "mixed-changing-dependency",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint,props.version]);return <span>{value}</span>;};",
    options: {
      filename: "mixed-changing-dependency.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "mutable-local-binding",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);let endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "mutable-local-binding.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "local-const-reassignment",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;endpoint=props.endpoint;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "local-const-reassignment.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "prop-backed-constant",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=props.endpoint;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "prop-backed-constant.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "opaque-provider-call",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=props.readEnvironment();useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "opaque-provider-call.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "dynamic-env-key",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env[props.key];useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "dynamic-env-key.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "computed-literal-env-key",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env['VITE_PUBLIC_ENDPOINT'];useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "computed-literal-env-key.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "whole-environment-value",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "whole-environment-value.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "lookalike-import-meta",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=props.importMeta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "lookalike-import-meta.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "env-property-assignment",
    code: "import {useEffect,useState} from 'react';\nimport.meta.env.VITE_PUBLIC_ENDPOINT='changed';\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "env-property-assignment.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "env-object-replacement",
    code: "import {useEffect,useState} from 'react';\nimport.meta.env={VITE_PUBLIC_ENDPOINT:'changed'};\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "env-object-replacement.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "env-property-update",
    code: "import {useEffect,useState} from 'react';\nimport.meta.env.VITE_PUBLIC_ENDPOINT++;\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "env-property-update.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "env-property-delete",
    code: "import {useEffect,useState} from 'react';\ndelete import.meta.env.VITE_PUBLIC_ENDPOINT;\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "env-property-delete.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "env-destructuring-write",
    code: "import {useEffect,useState} from 'react';\n({value:import.meta.env.VITE_PUBLIC_ENDPOINT}={value:'changed'});\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "env-destructuring-write.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "env-for-target",
    code: "import {useEffect,useState} from 'react';\nfor(import.meta.env.VITE_PUBLIC_ENDPOINT of ['changed']){}\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "env-for-target.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "environment-object-assign",
    code: "import {useEffect,useState} from 'react';\nObject.assign(import.meta.env,{VITE_PUBLIC_ENDPOINT:'changed'});\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "environment-object-assign.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "environment-alias-carrier",
    code: "import {useEffect,useState} from 'react';\nconst environment=import.meta.env;environment.VITE_PUBLIC_ENDPOINT='changed';\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "environment-alias-carrier.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "meta-alias-carrier",
    code: "import {useEffect,useState} from 'react';\nconst metadata=import.meta;metadata.env.VITE_PUBLIC_ENDPOINT='changed';\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "meta-alias-carrier.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "computed-meta-carrier",
    code: "import {useEffect,useState} from 'react';\nimport.meta['env'].VITE_PUBLIC_ENDPOINT='changed';\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "computed-meta-carrier.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "unknown-env-call-escape",
    code: "import {useEffect,useState} from 'react';\ninspect(import.meta.env);\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "unknown-env-call-escape.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "native-url-read",
    code: "import {useEffect,useState} from 'react';\nconst asset=new URL('./icon.svg',import.meta.url);\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "native-url-read.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "two-static-env-dependencies",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;const region=import.meta.env.VITE_PUBLIC_REGION;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint,region]);return <span>{value}</span>;};",
    options: {
      filename: "two-static-env-dependencies.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "const-identifier-alias-deferred",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const original=import.meta.env.VITE_PUBLIC_ENDPOINT;const endpoint=original;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "const-identifier-alias-deferred.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "legacy-module-constant",
    code: "import {useEffect,useState} from 'react';\nconst endpoint='static';\nconst Preview = (props) => {const [value,setValue]=useState(null);useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "legacy-module-constant.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "legacy-empty-deps",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[]);return <span>{value}</span>;};",
    options: {
      filename: "legacy-empty-deps.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "legacy-module-constant-despite-env-write",
    code: "import {useEffect,useState} from 'react';\nimport.meta.env.VITE_PUBLIC_ENDPOINT='changed';const endpoint='static';\nconst Preview = (props) => {const [value,setValue]=useState(null);useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "legacy-module-constant-despite-env-write.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "legacy-empty-deps-despite-env-write",
    code: "import {useEffect,useState} from 'react';\nimport.meta.env.VITE_PUBLIC_ENDPOINT='changed';\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[]);return <span>{value}</span>;};",
    options: {
      filename: "legacy-empty-deps-despite-env-write.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "nested-function-env-write",
    code: "import {useEffect,useState} from 'react';\nconst change=()=>{import.meta.env.VITE_PUBLIC_ENDPOINT='changed';};\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "nested-function-env-write.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "react-state-dependency",
    code: "import {useEffect,useState} from 'react';\nconst Preview=()=>{const[endpoint,setEndpoint]=useState('first');const[value,setValue]=useState(null);useEffect(()=>{void(async()=>{const next=await Promise.resolve('ready');setValue(next);})();},[endpoint]);return <button onClick={()=>setEndpoint('second')}>{value}</button>;};",
    options: {
      filename: "react-state-dependency.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "typed-env-const",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=(import.meta.env.VITE_PUBLIC_ENDPOINT as string);useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "typed-env-const.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "optional-environment-value",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env?.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "optional-environment-value.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "environment-method-call",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT.trim();useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "environment-method-call.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "callable-environment-value",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT();useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "callable-environment-value.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "meta-destructuring-carrier",
    code: "import {useEffect,useState} from 'react';\n\nconst {env}=import.meta;env.VITE_PUBLIC_ENDPOINT='changed';const Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "meta-destructuring-carrier.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "environment-define-property",
    code: "import {useEffect,useState} from 'react';\n\nObject.defineProperty(import.meta.env,'VITE_PUBLIC_ENDPOINT',{value:'changed'});const Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "environment-define-property.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "empty-vite-variable-suffix",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "empty-vite-variable-suffix.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "nested-environment-property",
    code: "import {useEffect,useState} from 'react';\n\nconst Preview = (props) => {const [value,setValue]=useState(null);const endpoint=import.meta.env.VITE_PUBLIC_ENDPOINT.value;useEffect(()=>{const load=async()=>{const next=await Promise.resolve('ready');setValue(next);};void load();},[endpoint]);return <span>{value}</span>;};",
    options: {
      filename: "nested-environment-property.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: ["react", "react:18", "vite"],
        },
      },
    },
    expected: 1,
  },
];

describe("Vite environment effect dependencies", () => {
  it.each(cases)("$name", ({ code, options, expected }) => {
    const result = runRule(noSetStateAfterAwaitInEffect, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});

describe("Vite environment dependencies in the wrapped host context", () => {
  it.each(
    cases.filter(({ name }) => name === "static-vite-env" || name === "env-property-assignment"),
  )("$name", ({ code, options, expected }) => {
    const result = runRule(wrapWithSemanticContext(noSetStateAfterAwaitInEffect), code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
