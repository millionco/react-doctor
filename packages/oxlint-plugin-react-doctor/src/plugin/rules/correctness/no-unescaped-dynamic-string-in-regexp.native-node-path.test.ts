import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnescapedDynamicStringInRegexp } from "./no-unescaped-dynamic-string-in-regexp.js";

const nativePathCases = [
  {
    name: "direct-canonical-resolve-unanchored-path",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-00.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "realpath-resolve-one-const-binding",
    code: "const fs = require('node:fs');\nconst path = require('node:path');\nconst resourcePath = fs.realpathSync(path.resolve(require.resolve('demo-native/package.json'), '..'));\nconst matcher = new RegExp(`${resourcePath}/target/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-01.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "separator-normalization-does-not-escape",
    code: "const path = require('node:path');\nconst matcher = new RegExp(`${path.resolve(__dirname, 'assets').replace(/[/\\\\]/g, '/')}.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-02.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "value-node-namespace-import",
    code: "import * as path from 'node:path';\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-03.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "single-readonly-alias",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst resource = rootPath;\nconst matcher = new RegExp(`${resource}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-04.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "name-alone-not-sanitizer",
    code: "const path = require('node:path');\nconst escapedRootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${escapedRootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-05.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "builtin-escape-terminal-wrapper",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${RegExp.escape(rootPath)}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-06.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "complete-replace-escape-terminal-wrapper",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst quoted = rootPath.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');\nconst matcher = new RegExp(`${quoted}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-07.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "authored-regexp-source",
    code: "const authored = /asset(?:s)?/;\nconst matcher = new RegExp(`${authored.source}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-08.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "literal-pattern",
    code: "const matcher = new RegExp('asset(?:s)?/bundle/.*');\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-09.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "shadowed-regexp-callee",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst RegExp = (value) => value;\nconst matcher = RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-10.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "shadowed-require",
    code: "const require = () => ({ resolve: () => 'asset.*' });\nconst path = require('node:path');\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-11.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "custom-provider-same-method",
    code: "const path = { resolve: () => 'asset.*' };\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-12.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "provider-member-reassigned",
    code: "const path = require('node:path');\npath.resolve = () => 'asset.*';\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-13.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "provider-transport",
    code: "const path = require('node:path');\nopaque(path);\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-14.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "mutable-local-result-binding",
    code: "const path = require('node:path');\nlet rootPath = path.resolve(__dirname, 'assets');\nrootPath = 'asset.*';\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-15.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "erased-eval-mask",
    code: "const path = require('node:path');\ndeclare const eval: (source: string) => unknown;\nconst rootPath = path.resolve(__dirname, 'assets');\neval('path.resolve = () => 0');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-16.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "unresolved-provider-member",
    code: "const path = require('node:path');\nconst method = readMethod();\nconst rootPath = path[method](__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-17.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "optional-path-call",
    code: "const path = require('node:path');\nconst rootPath = path.resolve?.(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-18.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "opaque-path-wrapper",
    code: "const path = require('node:path');\nconst prepare = (value) => value;\nconst rootPath = prepare(path.resolve(__dirname, 'assets'));\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-19.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "buffer-realpath-options",
    code: "const fs = require('node:fs');\nconst path = require('node:path');\nconst rootPath = fs.realpathSync(path.resolve(__dirname, 'assets'), { encoding: 'buffer' });\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-20.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "nonleading-character-class-role",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`[${rootPath}]`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-21.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "legacy-anchored-unproven-root",
    code: "const build = (rootPath) => new RegExp(`^${rootPath}/`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-22.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "unknown-computed-intrinsic-carrier",
    code: "const path = require('node:path');\nconst selector = readSelector();\nconst carrier = (false || '')[selector];\nopaque(carrier);\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-23.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "type-only-path-import",
    code: "import type * as path from 'node:path';\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-24.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "provider-property-descriptor-reflection",
    code: "const path = require('node:path');\nconst descriptor = Object.getOwnPropertyDescriptor(path, 'resolve');\nopaque(descriptor);\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-25.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "fake-escape-helper-no-actual-path-wrapper",
    code: "const path = require('node:path');\nconst escapeRegExp = (value) => value;\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${escapeRegExp(rootPath)}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-26.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "destructured-call-alias-not-v1",
    code: "const { resolve } = require('node:path');\nconst rootPath = resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-27.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "alternate-canonical-node-provider-write",
    code: "const path = require('node:path');\nconst alternatePath = require('path');\nalternatePath.resolve = () => 'authored.*';\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-28.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "recursive-require-source-reader-is-not-direct-namespace-proof",
    code: "const path = require('node:path').posix;\nconst rootPath = path.resolve('/assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-29.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "native-provider-method-value-transport",
    code: "const path = require('node:path');\nconst selectedResolve = path.resolve;\nobserve(selectedResolve);\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-30.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "source-valid-esm-namespace-native-cwd-producer",
    code: "import * as path from 'node:path';\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-31.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "direct-plus-native-producer",
    code: "const path = require('node:path');\nconst matcher = new RegExp(path.resolve('assets') + '/bundle/.*');\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-32.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ordinary-direct-regexp-call",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-33.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "two-additional-result-aliases-unsupported",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst first = rootPath; const second = first;\nconst matcher = new RegExp(`${second}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-34.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "result-used-before-declaration",
    code: "const path = require('node:path');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\nconst rootPath = path.resolve('assets');\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-35.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "exported-provider-namespace-transport",
    code: "export const path = require('node:path');\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-36.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "runtime-typescript-namespace",
    code: "namespace Carrier { export const ready = true; }\nconst path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-37.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "nested-erased-eval-reference",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst mutate = () => { interface eval {} eval('path.resolve = () => 0'); };\nmutate();\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-38.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "dynamic-import-provider-exposure",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst load = () => import('node:path');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-39.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "ordinary-static-numeric-member",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst labels = ['asset']; const selected = labels[0];\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-40.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "unresolved-destructured-selector",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst selector = readSelector(); const { [selector]: carrier } = {};\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-41.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "explicit-nonproduction-host",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/tests/case-42.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "omitted-filename-default-fixture-host",
    code: "const path = require('node:path');\nconst rootPath = path.resolve(__dirname, 'assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "existing-safe-character-dominating-guard",
    code: "const path = require('node:path');\nconst rootPath = path.resolve('assets');\nif (/^[a-z]*$/.test(rootPath)) { const matcher = new RegExp(`${rootPath}/bundle/.*`); }\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/case-44.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "direct-node-module-require-secondary-provider-write",
    code: "const path = require('node:path');\nconst loader = require('node:module');\nconst other = loader.createRequire(__filename)('node:path');\nother.resolve = () => 'authored.*';\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-45.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "node-module-namespace-loader-secondary-provider-write",
    code: "import * as path from 'node:path';\nimport * as loader from 'node:module';\nconst other = loader.createRequire('/synthetic/provider-entry.cjs')('node:path');\nother.resolve = () => 'authored.*';\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-46.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "module-named-loader-secondary-provider-write",
    code: "import * as path from 'node:path';\nimport { createRequire as makeLoader } from 'module';\nconst load = makeLoader('/synthetic/provider-entry.cjs');\nconst other = load('node:path');\nother.resolve = () => 'authored.*';\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-47.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "global-module-require-secondary-provider-write",
    code: "const path = require('node:path');\nconst other = module.require('node:path');\nother.resolve = () => 'authored.*';\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-48.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "global-process-builtin-secondary-provider-write",
    code: "const path = require('node:path');\nconst other = process.getBuiltinModule('node:path');\nother.resolve = () => 'authored.*';\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-49.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "ordinary-module-exports-retains-native-path-warning",
    code: "const path = require('node:path');\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\nmodule.exports = { matcher };\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-50.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
  },
  {
    name: "canonical-process-require-secondary-provider-write",
    code: "const path = require('node:path');\nconst runtime = require('node:process');\nconst other = runtime.getBuiltinModule('node:path');\nother.resolve = () => 'authored.*';\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-51.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "canonical-process-value-import-secondary-provider-write",
    code: "import * as path from 'node:path';\nimport * as runtime from 'process';\nconst other = runtime.getBuiltinModule('node:path');\nother.resolve = () => 'authored.*';\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-52.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "canonical-vm-require-path-provider-write",
    code: "const path = require('node:path');\nconst runtime = require('node:vm');\nruntime.runInThisContext(\"process.getBuiltinModule('node:path').resolve = () => 'authored.*'\");\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-53.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "canonical-vm-value-namespace-path-provider-write",
    code: "import * as path from 'node:path';\nimport * as runtime from 'vm';\nruntime.runInThisContext(\"process.getBuiltinModule('node:path').resolve = () => 'authored.*'\");\nconst rootPath = path.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/independent-case-54.js",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
  },
  {
    name: "as-any-path-namespace-receiver",
    code: "const path = require('node:path');\nconst rootPath = (path as any).resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/receiver-55.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
    expectedLocations: [
      {
        line: 3,
        column: 16,
      },
    ],
  },
  {
    name: "non-null-path-namespace-receiver",
    code: "const path = require('node:path');\nconst rootPath = (path!).resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/receiver-56.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
    expectedLocations: [
      {
        line: 3,
        column: 16,
      },
    ],
  },
  {
    name: "wrapped-realpath-and-resolve-receivers",
    code: "const fs = require('node:fs');\nconst path = require('node:path');\nconst rootPath = (fs as any).realpathSync((path!).resolve('assets'));\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/receiver-57.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 1,
    expectedLocations: [
      {
        line: 4,
        column: 16,
      },
    ],
  },
  {
    name: "wrapped-provider-write-declines",
    code: "const path = require('node:path');\n(path as any).resolve = () => 'authored.*';\nconst rootPath = (path as any).resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/receiver-58.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
    expectedLocations: [],
  },
  {
    name: "wrapped-method-transport-declines",
    code: "const path = require('node:path');\nconst resolve = (path as any).resolve;\nconst rootPath = resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/receiver-59.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
    expectedLocations: [],
  },
  {
    name: "wrapped-optional-call-declines",
    code: "const path = require('node:path');\nconst rootPath = (path as any)?.resolve('assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/receiver-60.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
    expectedLocations: [],
  },
  {
    name: "wrapped-path-with-escaped-regexp-argument-declines",
    code: "const path = require('node:path');\nconst rootPath = (path as any).resolve('assets');\nconst matcher = new RegExp(`${RegExp.escape(rootPath)}/bundle/.*`);\n",
    options: {
      filename: "/private/react-doctor-synthetic/literal-node-path/src/receiver-61.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          capabilities: [],
        },
      },
    },
    expected: 0,
    expectedLocations: [],
  },
];

describe("closed native Node path RegExp patterns", () => {
  for (const scenario of nativePathCases) {
    it(scenario.name, () => {
      const result = runRule(noUnescapedDynamicStringInRegexp, scenario.code, scenario.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
      if ("expectedLocations" in scenario) {
        expect(result.diagnostics.map(({ line, column }) => ({ line, column }))).toEqual(
          scenario.expectedLocations,
        );
      }
    });
  }
});
