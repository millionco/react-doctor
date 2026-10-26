import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "./no-promise-then-side-effect-in-effect-without-catch.js";

interface NativeRepeatModeCase {
  readonly name: string;
  readonly source: string;
  readonly count: number;
  readonly filename?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly ancestorManifest?: Readonly<Record<string, unknown>>;
}
const baseSource =
  'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};';
const baseManifest = {
  name: "synthetic-audio-panel",
  private: true,
  dependencies: {
    react: "18.2.0",
    "react-native": "0.73.6",
    expo: "~50.0.14",
    "react-native-track-player": "^4.1.1",
  },
};
const cases: ReadonlyArray<NativeRepeatModeCase> = [
  {
    name: "native default import with direct genuine setter",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
  },
  {
    name: "renamed default import",
    source:
      'import {useEffect,useState} from "react";\nimport PlaybackApi from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{PlaybackApi.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
  },
  {
    name: "transparent receiver and call wrappers",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{((Media as typeof Media)!).getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
  },
  {
    name: "ordinary direct second SDK method",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nconst changeMode=()=>Media.setRepeatMode(0);',
    count: 1,
  },
  {
    name: "ordinary default Expo Babel and source aliases",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
    files: {
      "babel.config.js":
        "module.exports = function (api) { api.cache(true); return {presets: ['babel-preset-expo']}; };",
      "tsconfig.json":
        '{"extends": "expo/tsconfig.base", "compilerOptions": {"strict": true, "target": "ES6", "module": "commonjs", "moduleResolution": "Node", "jsx": "react-native", "baseUrl": ".", "paths": {"@/*": ["./src/*"], "@/assets/*": ["./assets/*"]}}}',
    },
  },
  {
    name: "native shared source in mixed package",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1", "react-dom": "18.2.0"}}',
    },
  },
  {
    name: "genuine setter callback body",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(value=>setMode(value));},[]);return null;};',
    count: 1,
  },
  {
    name: "finally without rejection handler",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode).finally(()=>{});},[]);return null;};',
    count: 1,
  },
  {
    name: "explicit catch",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode).catch(()=>{});},[]);return null;};',
    count: 0,
  },
  {
    name: "second then rejection argument",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode,()=>{});},[]);return null;};',
    count: 0,
  },
  {
    name: "existing covering binding catch",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{const pending=Media.getRepeatMode().then(setMode);pending.catch(()=>{});},[]);return null;};',
    count: 0,
  },
  {
    name: "chain outside effect",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);Media.getRepeatMode().then(setMode);return null;};',
    count: 0,
  },
  {
    name: "then has no state or ref effect",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(value=>value);},[]);return null;};',
    count: 0,
  },
  {
    name: "explicit web suffix",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    filename: "entry.web.tsx",
  },
  {
    name: "web-only package",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "synthetic-browser-panel", "dependencies": {"react": "18.2.0", "react-dom": "18.2.0", "react-native-track-player": "4.1.1"}}',
    },
  },
  {
    name: "unknown target",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "synthetic-neutral-panel", "dependencies": {"react": "18.2.0", "react-native-track-player": "4.1.1"}}',
    },
  },
  {
    name: "local or parameter lookalike",
    source:
      'import {useEffect,useState} from "react";\nconst Media={getRepeatMode:()=>Promise.resolve(0)};\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
  },
  {
    name: "named or namespace import",
    source:
      'import {useEffect,useState} from "react";\nimport * as Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
  },
  {
    name: "destructured method or saved method alias",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{readMode().then(setMode);},[]);return null;};\nconst readMode=Media.getRepeatMode;',
    count: 0,
  },
  {
    name: "barrel or own wrapper import",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "./bridge";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "bridge.ts": 'export {default} from "react-native-track-player";',
    },
  },
  {
    name: "optional call or member",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode?.().then(setMode);},[]);return null;};',
    count: 0,
  },
  {
    name: "computed member or extra arguments",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media["getRepeatMode"]().then(setMode);},[]);return null;};',
    count: 0,
  },
  {
    name: "selected method assignment delete or update",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nMedia.getRepeatMode=async()=>0;',
    count: 0,
  },
  {
    name: "default namespace capability escape",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nexport const exposed=Media;',
    count: 0,
  },
  {
    name: "selected property mutation through readonly alias",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nconst alternate=Media;alternate.getRepeatMode=async()=>0;',
    count: 0,
  },
  {
    name: "NativeModules TrackPlayerModule replacement",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nimport {NativeModules} from "react-native";NativeModules.TrackPlayerModule={getRepeatMode:async()=>0};',
    count: 0,
  },
  {
    name: "reflection prototype evaluator capability",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nReflect.set(Media,"getRepeatMode",async()=>0);',
    count: 0,
  },
  {
    name: "type-only annotation",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\ninterface ModeState {value:number};type Callback=()=>void;',
    count: 1,
  },
  {
    name: "package npm alias file workspace or patch source",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "npm:other-player@4.1.1"}}',
    },
  },
  {
    name: "plain caret tilde 4.1.1 declaration",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "~4.1.1"}}',
    },
  },
  {
    name: "installed conflicting version",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "node_modules/react-native-track-player/package.json":
        '{"name": "react-native-track-player", "version": "4.2.0"}',
    },
  },
  {
    name: "unrecognized installed or declared version",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "4.0.0"}}',
    },
  },
  {
    name: "tsconfig target alias or baseUrl shim",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"baseUrl": ".", "paths": {"react-native-track-player": ["./foreign.ts"]}}}',
      "foreign.ts": "export default {getRepeatMode:async()=>0};",
    },
  },
  {
    name: "ancestor package overrides resolutions browser imports",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    ancestorManifest: {
      private: true,
      overrides: {
        "react-native-track-player": "other-player",
      },
    },
  },
  {
    name: "Metro resolver custom config",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "metro.config.js": "module.exports={resolver:{resolveRequest:foreign}};",
    },
  },
  {
    name: "Babel module-resolver custom plugin",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "babel.config.js":
        'module.exports=function(api){api.cache(true);return {presets:["babel-preset-expo"],plugins:["module-resolver"]}};',
    },
  },
  {
    name: "React provider source remap",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "tsconfig.json":
        '{"compilerOptions": {"baseUrl": ".", "paths": {"react": ["./fake-react.ts"]}}}',
      "fake-react.ts": "export const useEffect=()=>{};export const useState=()=>[0,()=>{}];",
    },
  },
  {
    name: "own package native entry remaps imported SDK",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1"}, "react-native": {"react-native-track-player": "./web-shim.js"}}',
    },
  },
  {
    name: "ancestor package native entry remaps imported SDK",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    ancestorManifest: {
      private: true,
      "react-native": {
        "react-native-track-player": "./web-shim.js",
      },
    },
  },
  {
    name: "self-referencing SDK package export is not genuine provider",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "react-native-track-player", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1"}, "exports": "./web-shim.js"}',
    },
  },
  {
    name: "installed canonical native entry metadata",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
    files: {
      "node_modules/react-native-track-player/package.json":
        '{"name": "react-native-track-player", "version": "4.1.1", "main": "lib/src/index.js", "source": "src/index", "react-native": "src/index"}',
    },
  },
  {
    name: "installed same-version native entry remap",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "node_modules/react-native-track-player/package.json":
        '{"name": "react-native-track-player", "version": "4.1.1", "main": "lib/src/index.js", "source": "src/index", "react-native": "./web-shim.js"}',
    },
  },
  {
    name: "installed same-version conditional exports remap",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "node_modules/react-native-track-player/package.json":
        '{"name": "react-native-track-player", "version": "4.1.1", "main": "lib/src/index.js", "source": "src/index", "react-native": "src/index", "exports": {"react-native": "./web-shim.js"}}',
    },
  },
  {
    name: "installed same-version browser remap",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "node_modules/react-native-track-player/package.json":
        '{"name": "react-native-track-player", "version": "4.1.1", "main": "lib/src/index.js", "source": "src/index", "react-native": "src/index", "browser": "./web-shim.js"}',
    },
  },
  {
    name: "additional Babel cts hook refuses profile",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      ".babelrc.cts": 'module.exports={plugins:["module-resolver"]};',
    },
  },
  {
    name: "additional Babel json5 hook refuses profile",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "babel.config.json5": '{plugins:["module-resolver"]}',
    },
  },
  {
    name: "alternate default SDK import replaces getter",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nimport Alternate from "react-native-track-player";Alternate.getRepeatMode=async()=>0;',
    count: 0,
  },
  {
    name: "alternate namespace default SDK import replaces getter",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nimport * as Alternate from "react-native-track-player";Alternate.default.getRepeatMode=async()=>0;',
    count: 0,
  },
  {
    name: "alternate named default SDK import replaces getter",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nimport {default as Alternate} from "react-native-track-player";Alternate.getRepeatMode=async()=>0;',
    count: 0,
  },
  {
    name: "additional SDK enum import used only as erased type",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nimport {RepeatMode} from "react-native-track-player";interface SavedMode {value:RepeatMode};',
    count: 1,
  },
  {
    name: "own file dependency replaces literal Expo preset",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "babel.config.js":
        'module.exports=function(api){api.cache(true);return {presets:["babel-preset-expo"]};};',
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1", "babel-preset-expo": "file:./shim"}}',
    },
  },
  {
    name: "ancestor alias dependency replaces literal Expo preset",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "babel.config.js":
        'module.exports=function(api){api.cache(true);return {presets:["babel-preset-expo"]};};',
    },
    ancestorManifest: {
      private: true,
      dependencies: {
        "babel-preset-expo": "npm:other-preset@10.0.1",
      },
    },
  },
  {
    name: "explicit canonical Expo preset declaration",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
    files: {
      "babel.config.js":
        'module.exports=function(api){api.cache(true);return {presets:["babel-preset-expo"]};};',
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1", "babel-preset-expo": "~10.0.1"}}',
    },
  },
  {
    name: "Expo base compiler alias resolves to local provider",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "tsconfig.json":
        '{"extends": "expo/tsconfig.base", "compilerOptions": {"baseUrl": ".", "paths": {"expo/tsconfig.base": ["./compiler-base.json"]}}}',
      "compiler-base.json": "{}",
    },
  },
  {
    name: "Babel preset compiler alias resolves to local provider",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "babel.config.js":
        'module.exports=function(api){api.cache(true);return {presets:["babel-preset-expo"]};};',
      "tsconfig.json":
        '{"compilerOptions": {"baseUrl": ".", "paths": {"babel-preset-expo": ["./preset.ts"]}}}',
      "preset.ts": "export default ()=>({visitor:{}});",
    },
  },
  {
    name: "React Native self global evaluator capability",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};\nself.eval("global.NativeModules.TrackPlayerModule.getRepeatMode=async()=>0");',
    count: 0,
  },
  {
    name: "nearest unsupported active Webpack5 config script",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1"}, "scripts": {"build": "webpack --config ./build/native.mjs"}, "devDependencies": {"webpack": "5.0.0"}}',
      "build/native.mjs":
        'export default {resolve:{alias:{"react-native-track-player":"./shim"}}};',
    },
  },
  {
    name: "ancestor unsupported active custom config script",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    ancestorManifest: {
      private: true,
      scripts: {
        build: "webpack --config ./build/native.mjs",
      },
      devDependencies: {
        webpack: "5.0.0",
      },
    },
    files: {
      "build/native.mjs":
        'export default {resolve:{alias:{"react-native-track-player":"./shim"}}};',
    },
  },
  {
    name: "ordinary Expo Android iOS and lint commands",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1"}, "scripts": {"android": "expo run:android", "ios": "expo run:ios", "lint": "eslint ."}}',
    },
  },
  {
    name: "ordinary native and passive maintenance recipes",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 1,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1"}, "scripts": {"android": "react-native run-android", "ios": "react-native run-ios", "start": "react-native start", "lint": "eslint .", "typecheck": "tsc --noEmit", "test": "vitest run", "format": "prettier --write .", "format:check": "prettier --check ."}}',
    },
  },
  {
    name: "trailing shell command is not canonical Expo recipe",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1"}, "scripts": {"android": "expo run:android; webpack --config ./build/native.mjs"}}',
      "build/native.mjs":
        'export default {resolve:{alias:{"react-native-track-player":"./shim"}}};',
    },
  },
  {
    name: "lifecycle command cannot inherit ordinary recipe permission",
    source:
      'import {useEffect,useState} from "react";\nimport Media from "react-native-track-player";\nexport const PlaybackPanel=()=>{const [mode,setMode]=useState(0);useEffect(()=>{Media.getRepeatMode().then(setMode);},[]);return null;};',
    count: 0,
    files: {
      "package.json":
        '{"name": "synthetic-audio-panel", "private": true, "dependencies": {"react": "18.2.0", "react-native": "0.73.6", "expo": "~50.0.14", "react-native-track-player": "^4.1.1"}, "scripts": {"postinstall": "eslint ."}}',
    },
  },
];
const temporaryRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-native-repeat-"));
afterAll(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
const writeProjectFile = (directory: string, name: string, body: string): void => {
  const filename = path.join(directory, name);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, body);
};
describe("native repeat-mode promise origin", () => {
  for (const testCase of cases)
    it(testCase.name, () => {
      const directory = fs.mkdtempSync(path.join(temporaryRoot, "case-"));
      const project = path.join(directory, "application");
      fs.mkdirSync(project);
      writeProjectFile(project, "package.json", JSON.stringify(baseManifest));
      for (const [name, body] of Object.entries(testCase.files ?? {}))
        writeProjectFile(project, name, body);
      if (testCase.ancestorManifest)
        writeProjectFile(directory, "package.json", JSON.stringify(testCase.ancestorManifest));
      const filename = path.join(project, testCase.filename ?? "entry.tsx");
      writeProjectFile(project, testCase.filename ?? "entry.tsx", testCase.source);
      resetFilesystemCaches();
      const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, testCase.source, {
        filename,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
});
describe("native repeat-mode environment freshness", () => {
  it("rechecks missing manifest appearance and removal with one AST", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "manifest-"));
    const filename = path.join(directory, "entry.tsx");
    const parsed = parseFixture(baseSource, { filename });
    const inspect = () => {
      resetFilesystemCaches();
      return runRuleOnParsedFixture(
        noPromiseThenSideEffectInEffectWithoutCatch,
        baseSource,
        parsed,
        { filename },
      ).diagnostics;
    };
    expect(inspect()).toHaveLength(0);
    writeProjectFile(directory, "package.json", JSON.stringify(baseManifest));
    expect(inspect()).toHaveLength(1);
    fs.unlinkSync(path.join(directory, "package.json"));
    expect(inspect()).toHaveLength(0);
  });
  it("rechecks package remap mutation and restore with one AST", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "remap-"));
    const filename = path.join(directory, "entry.tsx");
    const parsed = parseFixture(baseSource, { filename });
    const inspect = () => {
      resetFilesystemCaches();
      return runRuleOnParsedFixture(
        noPromiseThenSideEffectInEffectWithoutCatch,
        baseSource,
        parsed,
        { filename },
      ).diagnostics;
    };
    writeProjectFile(directory, "package.json", JSON.stringify(baseManifest));
    expect(inspect()).toHaveLength(1);
    writeProjectFile(
      directory,
      "package.json",
      JSON.stringify({ ...baseManifest, browser: { "react-native-track-player": "./web.ts" } }),
    );
    expect(inspect()).toHaveLength(0);
    writeProjectFile(directory, "package.json", JSON.stringify(baseManifest));
    expect(inspect()).toHaveLength(1);
  });
  it("rechecks conflicting installed provider appearance and removal", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "installed-"));
    const filename = path.join(directory, "entry.tsx");
    const parsed = parseFixture(baseSource, { filename });
    const inspect = () => {
      resetFilesystemCaches();
      return runRuleOnParsedFixture(
        noPromiseThenSideEffectInEffectWithoutCatch,
        baseSource,
        parsed,
        { filename },
      ).diagnostics;
    };
    writeProjectFile(directory, "package.json", JSON.stringify(baseManifest));
    expect(inspect()).toHaveLength(1);
    writeProjectFile(
      directory,
      "node_modules/react-native-track-player/package.json",
      JSON.stringify({ name: "react-native-track-player", version: "4.2.0" }),
    );
    expect(inspect()).toHaveLength(0);
    fs.rmSync(path.join(directory, "node_modules"), { recursive: true, force: true });
    expect(inspect()).toHaveLength(1);
  });
  it("rechecks explicit web target with the same parsed body", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "target-"));
    const filename = path.join(directory, "entry.tsx");
    writeProjectFile(directory, "package.json", JSON.stringify(baseManifest));
    const parsed = parseFixture(baseSource, { filename });
    resetFilesystemCaches();
    expect(
      runRuleOnParsedFixture(noPromiseThenSideEffectInEffectWithoutCatch, baseSource, parsed, {
        filename,
      }).diagnostics,
    ).toHaveLength(1);
    resetFilesystemCaches();
    expect(
      runRuleOnParsedFixture(noPromiseThenSideEffectInEffectWithoutCatch, baseSource, parsed, {
        filename: path.join(directory, "entry.web.tsx"),
      }).diagnostics,
    ).toHaveLength(0);
  });
  it("declines caching every potential API arm before environment resolution", () => {
    for (const source of [
      baseSource,
      baseSource.replace("react-native-track-player", "unknown-player"),
      baseSource.replace("Media.getRepeatMode()", "(Media.getRepeatMode)()"),
    ]) {
      const directory = fs.mkdtempSync(path.join(temporaryRoot, "probe-"));
      const filename = path.join(directory, "entry.tsx");
      expect(
        collectCrossFileDependencyProbes({
          absoluteFilePath: filename,
          sourceText: source,
          ruleIds: ["no-promise-then-side-effect-in-effect-without-catch"],
        }),
      ).toBeNull();
    }
  });
  it("uses actual parsed source rather than a mismatched saved entry", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "unsaved-"));
    const filename = path.join(directory, "entry.tsx");
    writeProjectFile(directory, "package.json", JSON.stringify(baseManifest));
    writeProjectFile(directory, "entry.tsx", baseSource);
    const source = baseSource + ";Media.getRepeatMode=async()=>0;";
    const parsed = parseFixture(source, { filename });
    resetFilesystemCaches();
    const result = runRuleOnParsedFixture(
      noPromiseThenSideEffectInEffectWithoutCatch,
      source,
      parsed,
      { filename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("native SDK installed entry freshness", () => {
  it("rechecks explicit native remap removal and canonical installed entry restore", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "native-entry-"));
    const filename = path.join(directory, "entry.tsx");
    const parsed = parseFixture(baseSource, { filename });
    const inspect = () => {
      resetFilesystemCaches();
      return runRuleOnParsedFixture(
        noPromiseThenSideEffectInEffectWithoutCatch,
        baseSource,
        parsed,
        { filename },
      ).diagnostics;
    };
    writeProjectFile(
      directory,
      "package.json",
      JSON.stringify({
        ...baseManifest,
        "react-native": { "react-native-track-player": "./web-shim.js" },
      }),
    );
    expect(inspect()).toHaveLength(0);
    writeProjectFile(directory, "package.json", JSON.stringify(baseManifest));
    expect(inspect()).toHaveLength(1);
    const canonical = {
      name: "react-native-track-player",
      version: "4.1.1",
      main: "lib/src/index.js",
      source: "src/index",
      "react-native": "src/index",
    };
    writeProjectFile(
      directory,
      "node_modules/react-native-track-player/package.json",
      JSON.stringify({ ...canonical, "react-native": "./web-shim.js" }),
    );
    expect(inspect()).toHaveLength(0);
    writeProjectFile(
      directory,
      "node_modules/react-native-track-player/package.json",
      JSON.stringify(canonical),
    );
    expect(inspect()).toHaveLength(1);
  });
});

describe("declared Expo compiler provider freshness", () => {
  it("rechecks explicit local preset replacement and ordinary provider restore", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "preset-provider-"));
    const filename = path.join(directory, "entry.tsx");
    const parsed = parseFixture(baseSource, { filename });
    const inspect = () => {
      resetFilesystemCaches();
      return runRuleOnParsedFixture(
        noPromiseThenSideEffectInEffectWithoutCatch,
        baseSource,
        parsed,
        { filename },
      ).diagnostics;
    };
    writeProjectFile(
      directory,
      "babel.config.js",
      'module.exports=function(api){api.cache(true);return {presets:["babel-preset-expo"]};};',
    );
    writeProjectFile(
      directory,
      "package.json",
      JSON.stringify({
        ...baseManifest,
        dependencies: { ...baseManifest.dependencies, "babel-preset-expo": "file:./shim" },
      }),
    );
    expect(inspect()).toHaveLength(0);
    writeProjectFile(
      directory,
      "package.json",
      JSON.stringify({
        ...baseManifest,
        dependencies: { ...baseManifest.dependencies, "babel-preset-expo": "~10.0.1" },
      }),
    );
    expect(inspect()).toHaveLength(1);
    writeProjectFile(directory, "package.json", JSON.stringify(baseManifest));
    expect(inspect()).toHaveLength(1);
  });
});

describe("declared native build script freshness", () => {
  it("rechecks nearest and ancestor custom build routes with the same AST", () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, "script-profile-"));
    const project = path.join(directory, "application");
    fs.mkdirSync(project);
    const filename = path.join(project, "entry.tsx");
    const parsed = parseFixture(baseSource, { filename });
    const inspect = () => {
      resetFilesystemCaches();
      return runRuleOnParsedFixture(
        noPromiseThenSideEffectInEffectWithoutCatch,
        baseSource,
        parsed,
        { filename },
      ).diagnostics;
    };
    const ordinary = {
      ...baseManifest,
      scripts: { android: "expo run:android", ios: "expo run:ios", lint: "eslint ." },
    };
    writeProjectFile(
      project,
      "package.json",
      JSON.stringify({ ...ordinary, scripts: { build: "webpack --config ./build/native.mjs" } }),
    );
    expect(inspect()).toHaveLength(0);
    writeProjectFile(project, "package.json", JSON.stringify(ordinary));
    expect(inspect()).toHaveLength(1);
    writeProjectFile(
      directory,
      "package.json",
      JSON.stringify({ private: true, scripts: { build: "webpack --config ./build/native.mjs" } }),
    );
    expect(inspect()).toHaveLength(0);
    fs.unlinkSync(path.join(directory, "package.json"));
    expect(inspect()).toHaveLength(1);
  });
});
