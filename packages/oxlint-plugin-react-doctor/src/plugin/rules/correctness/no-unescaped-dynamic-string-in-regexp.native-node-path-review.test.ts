import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnescapedDynamicStringInRegexp } from "./no-unescaped-dynamic-string-in-regexp.js";

const nativePathReviewCases = [
  {
    name: "nominal",
    code: "export {}; const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 1,
    group: "root",
  },
  {
    name: "provider-interface-before",
    code: "export {}; interface path {} const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 1,
    group: "root",
  },
  {
    name: "provider-interface-after",
    code: "export {}; const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`); interface path {}",
    expected: 1,
    group: "root",
  },
  {
    name: "provider-type-alias",
    code: "export {}; type path = {}; const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 1,
    group: "root",
  },
  {
    name: "regexp-interface",
    code: "export {}; interface RegExp {} const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 1,
    group: "root",
  },
  {
    name: "regexp-type-alias",
    code: "export {}; type RegExp = {}; const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 1,
    group: "root",
  },
  {
    name: "require-interface",
    code: "export {}; interface require {} const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 1,
    group: "root",
  },
  {
    name: "require-type-alias",
    code: "export {}; type require = {}; const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 1,
    group: "root",
  },
  {
    name: "provider-typeof-query",
    code: "export {}; const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`); type Provider = typeof path;",
    expected: 1,
    group: "root",
  },
  {
    name: "dirname-interface",
    code: "export {}; interface __dirname {} const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 1,
    group: "root",
  },
  {
    name: "type-only-provider-declines",
    code: "import type * as path from 'node:path'; const matcher = new RegExp(`${path.resolve('assets')}/bundle/.*`);",
    expected: 0,
    group: "root",
  },
  {
    name: "runtime-regexp-shadow-declines",
    code: "export {}; const RegExp = (value) => value; const path = require('node:path'); const rootPath = path.resolve(__dirname, 'assets'); const matcher = new RegExp(`${rootPath}/bundle/.*`);",
    expected: 0,
    group: "root",
  },
  {
    name: "nominal-readonly-path",
    code: "import * as path from 'node:path';\nconst rootPath = path.resolve('/tmp/assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    expected: 1,
    group: "owner",
  },
  {
    name: "readonly-alias",
    code: "import * as path from 'node:path';\nconst rootPath = path.resolve('/tmp/assets');\nconst aliasPath = rootPath;\nconst matcher = new RegExp(`${aliasPath}/bundle/.*`);\n",
    expected: 1,
    group: "owner",
  },
  {
    name: "plain-result-write",
    code: "import * as path from 'node:path';\nconst rootPath = path.resolve('/tmp/assets');\nrootPath = '/changed';\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    expected: 0,
    group: "owner",
  },
  {
    name: "destructured-result-write",
    code: "import * as path from 'node:path';\nconst rootPath = path.resolve('/tmp/assets');\n({rootPath} = {rootPath: '/changed'});\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    expected: 0,
    group: "owner",
  },
  {
    name: "actual-local-object",
    code: "const Object = 0; void Object;\nimport * as path from 'node:path';\nconst rootPath = path.resolve('/tmp/assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    expected: 1,
    group: "owner",
  },
  {
    name: "actual-local-string",
    code: "const String = 0; void String;\nimport * as path from 'node:path';\nconst rootPath = path.resolve('/tmp/assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    expected: 1,
    group: "owner",
  },
  {
    name: "actual-global-object",
    code: "Object.keys({});\nimport * as path from 'node:path';\nconst rootPath = path.resolve('/tmp/assets');\nconst matcher = new RegExp(`${rootPath}/bundle/.*`);\n",
    expected: 0,
    group: "owner",
  },
];

describe("native Node path runtime binding boundaries", () => {
  for (const scenario of nativePathReviewCases) {
    it(`${scenario.group}: ${scenario.name}`, () => {
      const result = runRule(noUnescapedDynamicStringInRegexp, scenario.code, {
        filename: "/private/react-doctor-synthetic/native-path-review/src/entry.tsx",
        settings: { "react-doctor": { capabilities: [] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
