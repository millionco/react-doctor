import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleDiagnostic } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

interface ImportedCookieFixture {
  readonly name: string;
  readonly code: string;
  readonly files: Readonly<Record<string, string>>;
  readonly diagnostics: ReadonlyArray<RuleDiagnostic>;
}

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "state-updater-cookie-"));
  __clearParseSourceFileCacheForTests();
  resetCrossFileExportCaches();
  resetModuleResolutionCaches();
  resetTsconfigAliasCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeCookieFixtureFile = (relativePath: string, content: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
  return filename;
};

const cookieFixtures: ReadonlyArray<ImportedCookieFixture> = [
  {
    name: "direct-import-cookie-assignment",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "renamed-tsconfig-import-cookie-assignment",
    code: 'import { useState } from "react";\nimport { setCookie as rememberPreference } from "@/persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    rememberPreference("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "direct-import-cookie-delete-assignment",
    code: 'import { useState } from "react";\nimport { clearPreference } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    clearPreference("view");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const clearPreference = (name: string) => {\n  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "same-spelling-pure-import",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => `${name}=${value}`;\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "helper-local-document-shadow",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie({ cookie: "" }, "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (document: { cookie: string }, value: string) => {\n  document.cookie = value;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "returned-callback-not-invoked",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => () => {\n  document.cookie = `${name}=${value}`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "generator-body-not-executed",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export function* setCookie(name: string, value: string) {\n  document.cookie = `${name}=${value}`;\n}\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "dead-updater-import-call",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    if (false) setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "live-export-replaced-by-pure-function",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export let setCookie = (name: string, value: string) => {\n  document.cookie = `${name}=${value}`;\n};\nsetCookie = () => undefined;\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "cookie-helper-called-outside-updater",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n const [count, setCount] = useState(0);\n return <button onClick={() => { setCookie("view", "compact"); setCount(previous => previous + 1); }}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "throwing-prelude-prevents-cookie-write",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        'export const setCookie = (name: string, value: string) => {\n  throw new Error("stopped");\n  document.cookie = `${name}=${value}`;\n};\n',
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "type-only-import",
    code: 'import { useState } from "react";\nimport type { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "inline-type-only-import",
    code: 'import { useState } from "react";\nimport { type setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "caller-shadowed-helper",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  const setCookie = (name: string, value: string) => `${name}=${value}`;\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "caller-document-shadow-does-not-shadow-foreign-global",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  const document = { cookie: "local" };\n  void document;\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 8,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "foreign-encoding-shadow",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "const encodeURIComponent = (value: string) => { throw new Error(value); };\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "visible-cookie-provider-replacement",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        'Object.defineProperty(document, "cookie", { configurable: true, set() {} });\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "unrelated-module-timer-does-not-hide-cookie-write",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "setTimeout(() => undefined, 0);\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "literal-dom-creation-is-not-input-specific",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  document.createElement("section");\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 7,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "native-document-prototype-cookie-replacement",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        'Object.defineProperty(Document.prototype, "cookie", { configurable: true, set() {} });\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "function-document-replacement",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "Function(\"globalThis.document = { cookie: '' }\")();\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "global-function-document-replacement",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "globalThis.Function(\"globalThis.document = { cookie: '' }\")();\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "object-document-replacement",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        'Object.defineProperty(globalThis, "document", {value: {cookie: ""}, configurable: true});\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "erased-document-interface",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "interface document {}\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-encode-interface",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "interface encodeURIComponent {}\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-nested-provider-pattern",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "type Note = ({nested: {Document}}: {nested:{Document:string}}) => void;\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "runtime-parameter-default",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "class Configure {constructor(public value = Function(\"globalThis.document = { cookie: '' }\")()) {}}\nnew Configure();\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "erased-Function-still-rejects-runtime-provider-replacement",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "interface Function {}\nFunction(\"globalThis.document = { cookie: '' }\")();\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "ambient-document-function",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "declare function document(): void;\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "ambient-document-const",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "declare const document: {cookie: string};\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "erased-interface-ambient-companion",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "interface document {}\ndeclare const document: {cookie: string};\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "ambient-encode-function",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "declare function encodeURIComponent(value: string): string;\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "default-exported-ambient-document-provider",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "export default function document(): void;\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "fresh-document-getter-function",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        'Function("Object.defineProperty(globalThis, \\"document\\", { configurable: true, get: () => ({ cookie: \\"\\" }) });")();\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "fresh-document-getter-global-function",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        'globalThis.Function("Object.defineProperty(globalThis, \\"document\\", { configurable: true, get: () => ({ cookie: \\"\\" }) });")();\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "unindexed-catch-default-fresh-getter",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        'try { throw {}; } catch ({ _ignored = Function("Object.defineProperty(globalThis, \\"document\\", { configurable: true, get: () => ({ cookie: \\"\\" }) });")() }) {}\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
      "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
    },
    diagnostics: [],
  },
  {
    name: "mixed-commonjs-module-replaces-export",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist.cts";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.cts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\nmodule.exports = { setCookie: () => undefined };\n",
    },
    diagnostics: [],
  },
  {
    name: "mixed-commonjs-exports-replaces-export",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist.cts";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.cts":
        "export const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\nexports.setCookie = () => undefined;\n",
    },
    diagnostics: [],
  },
  {
    name: "commonjs-capability-type-names-are-erased",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        "interface module { exports: string }\ntype exports = { module: string };\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n",
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "commonjs-capability-static-keys-are-data",
    code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
    files: {
      "persist.ts":
        'const metadata = { module: "label", exports: "label" };\nvoid metadata;\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
    },
    diagnostics: [
      {
        column: 4,
        line: 6,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
];

const runCookieFixture = (fixture: ImportedCookieFixture) => {
  for (const [filename, content] of Object.entries(fixture.files))
    writeCookieFixtureFile(filename, content);
  const filename = writeCookieFixtureFile("component.tsx", fixture.code);
  return runRule(noSideEffectInStateUpdaterFunction, fixture.code, {
    filename,
    includeLocations: true,
  });
};

const collectCookieFixtureDependencies = (code: string) =>
  collectCrossFileDependencyProbes({
    absoluteFilePath: path.join(temporaryDirectory, "component.tsx"),
    sourceText: code,
    ruleIds: ["no-side-effect-in-state-updater-function"],
  });

describe("no-side-effect-in-state-updater-function imported cookie writes", () => {
  for (const fixture of cookieFixtures) {
    it(fixture.name, () => {
      expect(runCookieFixture(fixture)).toEqual({
        diagnostics: fixture.diagnostics,
        parseErrors: [],
      });
    });
  }

  it("refreshes the imported body after an edit or deletion", () => {
    const fixture = cookieFixtures[0];
    expect(runCookieFixture(fixture)).toEqual({
      diagnostics: fixture.diagnostics,
      parseErrors: [],
    });
    const helperPath = path.join(temporaryDirectory, "persist.ts");
    const dependencies = collectCookieFixtureDependencies(fixture.code);
    expect(dependencies?.contentPaths.has(helperPath)).toBe(true);
    fs.writeFileSync(
      helperPath,
      "export const setCookie = (name: string, value: string) => `${name}=${value}`;\n",
    );
    const runCurrent = () =>
      runRule(noSideEffectInStateUpdaterFunction, fixture.code, {
        filename: path.join(temporaryDirectory, "component.tsx"),
        includeLocations: true,
      });
    expect(runCurrent()).toEqual({ diagnostics: [], parseErrors: [] });
    fs.unlinkSync(helperPath);
    expect(runCurrent()).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("records missing resolution candidates before a new file shadows a helper", () => {
    const fixture = cookieFixtures[0];
    writeCookieFixtureFile("persist.tsx", fixture.files["persist.ts"]);
    writeCookieFixtureFile("component.tsx", fixture.code);
    const runCurrent = () =>
      runRule(noSideEffectInStateUpdaterFunction, fixture.code, {
        filename: path.join(temporaryDirectory, "component.tsx"),
        includeLocations: true,
      });
    expect(runCurrent()).toEqual({ diagnostics: fixture.diagnostics, parseErrors: [] });
    const dependencies = collectCookieFixtureDependencies(fixture.code);
    expect(dependencies?.existencePaths.has(path.join(temporaryDirectory, "persist.ts"))).toBe(
      true,
    );
    expect(dependencies?.contentPaths.has(path.join(temporaryDirectory, "persist.tsx"))).toBe(true);
    writeCookieFixtureFile(
      "persist.ts",
      "export const setCookie = (name: string, value: string) => `${name}=${value}`;\n",
    );
    resetModuleResolutionCaches();
    resetCrossFileExportCaches();
    expect(runCurrent()).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("records the alias configuration and follows a retargeted helper", () => {
    const fixture = cookieFixtures[1];
    expect(runCookieFixture(fixture)).toEqual({
      diagnostics: fixture.diagnostics,
      parseErrors: [],
    });
    const dependencies = collectCookieFixtureDependencies(fixture.code);
    expect(dependencies?.contentPaths.has(path.join(temporaryDirectory, "tsconfig.json"))).toBe(
      true,
    );
    expect(dependencies?.contentPaths.has(path.join(temporaryDirectory, "persist.ts"))).toBe(true);
    writeCookieFixtureFile(
      "alternate/persist.ts",
      "export const setCookie = (name: string, value: string) => `${name}=${value}`;\n",
    );
    writeCookieFixtureFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@/*": ["./alternate/*"] } } }),
    );
    resetTsconfigAliasCaches();
    resetModuleResolutionCaches();
    resetCrossFileExportCaches();
    const currentDependencies = collectCookieFixtureDependencies(fixture.code);
    expect(
      currentDependencies?.contentPaths.has(path.join(temporaryDirectory, "alternate/persist.ts")),
    ).toBe(true);
    expect(
      runRule(noSideEffectInStateUpdaterFunction, fixture.code, {
        filename: path.join(temporaryDirectory, "component.tsx"),
        includeLocations: true,
      }),
    ).toEqual({ diagnostics: [], parseErrors: [] });
  });
  it("declines an erased Document binding masking a native prototype replacement", () => {
    const fixture = {
      name: "erased-document-interface-masks-runtime-native-prototype-replacement",
      code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
      files: {
        "persist.ts":
          'interface Document {}\nObject.defineProperty(Document.prototype, "cookie", {\n  configurable: true,\n  get() { return ""; },\n  set(value) {},\n});\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
        "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
      },
      diagnostics: [],
    };
    expect(runCookieFixture(fixture)).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("declines erased namespace and ambient namespace cookie provider references", () => {
    for (const providerPrefix of [
      'interface globalThis {}\nObject.defineProperty(globalThis.document, "cookie", { configurable: true, set() {} });\n',
      'declare const window: Window;\nObject.defineProperty(window.Document.prototype, "cookie", { configurable: true, set() {} });\n',
    ]) {
      const fixture = cookieFixtures[0];
      expect(
        runCookieFixture({
          ...fixture,
          files: { ...fixture.files, "persist.ts": providerPrefix + fixture.files["persist.ts"] },
        }),
      ).toEqual({ diagnostics: [], parseErrors: [] });
    }
  });

  it("does not mistake an unused interface declaration for a runtime provider escape", () => {
    const fixture = cookieFixtures[0];
    expect(
      runCookieFixture({
        ...fixture,
        files: {
          ...fixture.files,
          "persist.ts": "interface Document {}\n" + fixture.files["persist.ts"],
        },
      }),
    ).toEqual({ diagnostics: fixture.diagnostics, parseErrors: [] });
  });

  it("declines a runtime parameter property hiding a cookie provider replacement", () => {
    const fixture = {
      name: "runtime-parameter-property-cookie-provider-replacement",
      code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
      files: {
        "persist.ts":
          'class ConfigureCookieProvider {\n  constructor(public value = Object.defineProperty(Document.prototype, "cookie", {\n    configurable: true,\n    get() { return ""; },\n    set(value) {},\n  })) {}\n}\nnew ConfigureCookieProvider();\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
        "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
      },
      diagnostics: [],
    };
    expect(runCookieFixture(fixture)).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("declines a selected provider reference omitted from a computed catch binding", () => {
    const fixture = {
      name: "computed-catch-binding-cookie-provider-replacement",
      code: 'import { useState } from "react";\nimport { setCookie } from "./persist";\nexport const Preference = () => {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(previous => {\n    setCookie("view", "compact");\n    return previous + 1;\n  })}>{count}</button>;\n};\n',
      files: {
        "persist.ts":
          'try {\n  throw {};\n} catch ({ [(Object.defineProperty(Document.prototype, "cookie", {\n  configurable: true,\n  get() { return ""; },\n  set(value) {},\n}), "value")]: ignored }) {}\nexport const setCookie = (name: string, value: string) => {\n  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/`;\n};\n',
        "tsconfig.json": '{"compilerOptions": {"paths": {"@/*": ["./*"]}, "jsx": "react-jsx"}}\n',
      },
      diagnostics: [],
    };
    expect(runCookieFixture(fixture)).toEqual({ diagnostics: [], parseErrors: [] });
  });

  it("preserves unrelated static property names matching selected providers", () => {
    const fixture = cookieFixtures[0];
    const code = fixture.code.replace(
      "  return <button",
      '  const metadata = { Document: "label", window: "label", document: "label", encodeURIComponent: "label" };\n  void metadata;\n  return <button',
    );
    expect(runCookieFixture({ ...fixture, code })).toEqual({
      diagnostics: [
        { column: 4, line: 8, message: fixture.diagnostics[0].message, nodeType: "CallExpression" },
      ],
      parseErrors: [],
    });
  });
});
