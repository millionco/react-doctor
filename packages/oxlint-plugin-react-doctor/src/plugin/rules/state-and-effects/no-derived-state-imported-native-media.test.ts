import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { createImportedNativeMediaGuardPredicate } from "./utils/create-imported-native-media-guard-predicate.js";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

interface ImportedNativeMediaCase {
  name: string;
  code: string;
  files: Readonly<Record<string, string>>;
  options: RunRuleOptions;
  expected: number;
}

let temporaryDirectory: string;
const resetModuleFacts = () => {
  __clearParseSourceFileCacheForTests();
  resetManifestCaches();
  resetCrossFileExportCaches();
  resetModuleResolutionCaches();
  resetTsconfigAliasCaches();
};
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-imported-media-"));
  resetModuleFacts();
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
const writeFixtureFiles = (files: Readonly<Record<string, string>>) => {
  for (const [relativePath, contents] of Object.entries(files)) {
    const filename = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
  }
};

const cases: ReadonlyArray<ImportedNativeMediaCase> = [
  {
    name: "direct-imported-native-result-conjunction",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "named-import-alias-native-result",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip as browserResult } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && browserResult(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip as browserResult } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && browserResult(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-1",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "renamed-export-native-result",
    code: 'import { useEffect, useState } from "react";\nimport { readCapability } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && readCapability(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { readCapability } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && readCapability(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function readCapability(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-2",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "same-name-pure-prop-helper",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts": 'export const supportsClip = (mime: string) => mime.startsWith("video/");\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-3",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "native-call-result-discarded",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'export const supportsClip = (mime: string) => { document.createElement("video").canPlayType(mime); return true; };\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-4",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "imported-helper-delegates-opaque",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'import { externalCheck } from "./external";\nexport const supportsClip = (mime: string) => externalCheck(mime);\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-5",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
      "external.ts": "export const externalCheck = (mime: string) => mime.length > 0;\n",
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "shadow-document-parameter",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'export const supportsClip = (mime: string, document = { createElement: (_tag: string) => ({ canPlayType: (_mime: string) => "probably" }) }) => document.createElement("video").canPlayType(mime) !== "";\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-6",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "default-import-profile-outside",
    code: 'import { useEffect, useState } from "react";\nimport supportsClip from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport supportsClip from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\nexport default supportsClip;\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-7",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "namespace-import-profile-outside",
    code: 'import { useEffect, useState } from "react";\nimport * as capability from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && capability.supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport * as capability from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && capability.supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-8",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "exported-function-reassigned",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\nsupportsClip = (_mime: string) => true;\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-9",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "or-prop-can-bypass-native",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (enabled || supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (enabled || supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-10",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "nearby-call-pure-guard",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    supportsClip(currentMime);\n    if (isCandidate) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    supportsClip(currentMime);\n    if (isCandidate) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-11",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "conjunction-opaque-call-tail",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (supportsClip(currentMime) && check(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (supportsClip(currentMime) && check(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-12",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "local-callee-alias-transport",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  const selectedCheck = supportsClip;\n  useEffect(() => {\n    \n    if (isCandidate && selectedCheck(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  const selectedCheck = supportsClip;\n  useEffect(() => {\n    \n    if (isCandidate && selectedCheck(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-13",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "exporter-native-provider-alias-escape",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\nconst carrier = document;\nexport const selectedProvider = carrier;\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-14",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "ambient-document-mask",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'declare const document: Document;\nconst SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-15",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "exporter-eval-alias",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\nconst evaluate = eval;\nexport const selectedEvaluator = evaluate;\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-16",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "type-only-import-used-as-value",
    code: 'import { useEffect, useState } from "react";\nimport type { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport type { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-17",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "optional-imported-call",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && supportsClip?.(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && supportsClip?.(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-18",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "async-exported-function",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport async function supportsClip(mime: string): Promise<boolean> {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-19",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "secondary-namespace-provider-transport",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nimport * as capabilities from "./capability";\n\nexport const Example = ({ mime, source, enabled, check, inspect }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean; inspect: (value: unknown) => void }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  inspect(capabilities);\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nimport * as capabilities from "./capability";\n\nexport const Example = ({ mime, source, enabled, check, inspect }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean; inspect: (value: unknown) => void }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  inspect(capabilities);\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-20",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "secondary-named-function-provider-escape",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nimport { supportsClip as anotherSupport } from "./capability";\n\nexport const Example = ({ mime, source, enabled, check, inspect }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean; inspect: (value: unknown) => void }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  inspect(anotherSupport);\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nimport { supportsClip as anotherSupport } from "./capability";\n\nexport const Example = ({ mime, source, enabled, check, inspect }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean; inspect: (value: unknown) => void }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  inspect(anotherSupport);\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-21",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "readonly-local-call-produced-conjunction-inputs",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip, normalizeClip, isClipKind } from "./capability";\ninterface ClipProps { mime: string | null; source: string; }\nexport const ClipPanel = ({ mime, source }: ClipProps) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = normalizeClip(mime);\n  const isCandidate = isClipKind(currentMime);\n  useEffect(() => {\n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip, normalizeClip, isClipKind } from "./capability";\ninterface ClipProps { mime: string | null; source: string; }\nexport const ClipPanel = ({ mime, source }: ClipProps) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = normalizeClip(mime);\n  const isCandidate = isClipKind(currentMime);\n  useEffect(() => {\n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null): string | null => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string | null): boolean => input !== null && SUPPORTED_KINDS.has(input.split(";", 1)[0]);\nexport const supportsClip = (mime: string): boolean => {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n};\n',
      "package.json":
        '{\n  "name": "synthetic-call-produced-guard-input",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "preceding-native-early-exit-does-not-guard-later-writer",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (supportsClip(currentMime)) return;\n    setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (supportsClip(currentMime)) return;\n    setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "exporter-parameter-write-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  mime = "video/other";\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "nonempty-support-comparison-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "maybe";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "exporter-native-provider-escape-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const detachedDocument = document;\nconst SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "consumer-document-provider-write-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  document.createElement = forgedElement;\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  document.createElement = forgedElement;\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "consumer-dynamic-import-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  void import("./capability");\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  void import("./capability");\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "consumer-ambient-provider-declaration-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\ndeclare const document: Document;\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\ndeclare const document: Document;\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "constructor-pattern-provider-screen-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  const { constructor: build } = () => {};\n  build("void 0")();\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  const { constructor: build } = () => {};\n  build("void 0")();\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "secondary-named-default-carrier-declines",
    code: 'import { useEffect, useState } from "react";\nimport { default as Provider } from "./capability";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  observe(Provider);\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { default as Provider } from "./capability";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  observe(Provider);\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "equivalent-relative-request-selected-function-escape-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip as escaped } from "./capability.ts";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  observe(escaped);\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip as escaped } from "./capability.ts";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  observe(escaped);\n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "mutable-conjunction-binding-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  let isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  let isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "member-conjunction-leaf-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (flags.enabled && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (flags.enabled && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "assignment-conjunction-leaf-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if ((isCandidate = enabled) && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if ((isCandidate = enabled) && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "negated-imported-native-call",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && !supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && !supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "readonly-const-conjunction-with-transparent-parens",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if ((isCandidate) && (currentMime) && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if ((isCandidate) && (currentMime) && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "direct-arrow-native-export",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'export const supportsClip = (mime: string) => document.createElement("video").canPlayType(mime) !== "";\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "direct-audio-native-export",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("audio").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "barrel-native-function-is-not-direct-export",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts": 'export { supportsClip } from "./implementation";\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
      "implementation.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "direct-export-specifier-alias-is-outside-profile",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nfunction supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\nexport { supportsClip };\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "opaque-native-call-argument-spread-declines",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(...[currentMime])) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(...[currentMime])) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
];

const adjustmentCases: ReadonlyArray<ImportedNativeMediaCase> = [
  {
    name: "constant-write-direct-imported-native-result-conjunction",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState(false);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(true);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState(false);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(true);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
  {
    name: "constant-write-same-name-pure-prop-helper",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState(false);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(true);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState(false);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(true);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected} />;\n};\n',
      "capability.ts": 'export const supportsClip = (mime: string) => mime.startsWith("video/");\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-3",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 1,
  },
  {
    name: "constant-write-readonly-local-call-produced-conjunction-inputs",
    code: 'import { useEffect, useState } from "react";\nimport { supportsClip, normalizeClip, isClipKind } from "./capability";\ninterface ClipProps { mime: string | null; source: string; }\nexport const ClipPanel = ({ mime, source }: ClipProps) => {\n  const [selected, setSelected] = useState(false);\n  const currentMime = normalizeClip(mime);\n  const isCandidate = isClipKind(currentMime);\n  useEffect(() => {\n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(true);\n  }, [isCandidate, currentMime, source]);\n  return <video data-selected={selected} />;\n};\n',
    files: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip, normalizeClip, isClipKind } from "./capability";\ninterface ClipProps { mime: string | null; source: string; }\nexport const ClipPanel = ({ mime, source }: ClipProps) => {\n  const [selected, setSelected] = useState(false);\n  const currentMime = normalizeClip(mime);\n  const isCandidate = isClipKind(currentMime);\n  useEffect(() => {\n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(true);\n  }, [isCandidate, currentMime, source]);\n  return <video data-selected={selected} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null): string | null => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string | null): boolean => input !== null && SUPPORTED_KINDS.has(input.split(";", 1)[0]);\nexport const supportsClip = (mime: string): boolean => {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n};\n',
      "package.json":
        '{\n  "name": "synthetic-call-produced-guard-input",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    options: {
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
    expected: 0,
  },
];

describe.each([noDerivedState, noDerivedStateEffect])("imported native media result", (rule) => {
  it.each(cases)("$name", ({ code, files, options, expected }) => {
    writeFixtureFiles(files);
    const result = runRule(rule, code, {
      ...options,
      filename: path.join(temporaryDirectory, "consumer.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
describe("imported native media constant write", () => {
  it.each(adjustmentCases)("$name", ({ code, files, options, expected }) => {
    writeFixtureFiles(files);
    const result = runRule(noAdjustStateOnPropChange, code, {
      ...options,
      filename: path.join(temporaryDirectory, "consumer.tsx"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});

interface ImportedMediaCacheTransition {
  name: string;
  initialFiles: Readonly<Record<string, string>>;
  mutation: { file: string; newContent: string };
  expectedAdmissionBefore: boolean;
  expectedAdmissionAfter: boolean;
  requiredProbes: ReadonlyArray<string>;
  purpose: string;
}

const cacheTransitions: ReadonlyArray<ImportedMediaCacheTransition> = [
  {
    name: "selected-exporter-content-mutation",
    initialFiles: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "capability.ts":
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    mutation: {
      file: "capability.ts",
      newContent: "export const supportsClip = (_mime: string) => true;\n",
    },
    expectedAdmissionBefore: true,
    expectedAdmissionAfter: false,
    requiredProbes: ["content:capability.ts"],
    purpose:
      "Cold and memo collectors must both include selected exporter content; invalidation must remove admission without any consumer edit.",
  },
  {
    name: "missing-helper-created",
    initialFiles: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
    },
    mutation: {
      file: "capability.ts",
      newContent:
        'const SUPPORTED_KINDS = new Set(["video/webm", "video/mp4"]);\nexport const normalizeClip = (input: string | null) => input?.trim().toLowerCase() || null;\nexport const isClipKind = (input: string) => SUPPORTED_KINDS.has(input);\nexport function supportsClip(mime: string): boolean {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
    },
    expectedAdmissionBefore: false,
    expectedAdmissionAfter: true,
    requiredProbes: ["existence:capability.ts"],
    purpose:
      "Negative resolution must fingerprint the candidate whose creation changes selected import identity.",
  },
  {
    name: "higher-priority-ts-module-created",
    initialFiles: {
      "consumer.tsx":
        'import { useEffect, useState } from "react";\nimport { supportsClip } from "./capability";\nexport const Example = ({ mime, source, enabled, check }: { mime: string; source: string; enabled: boolean; check: (value: string) => boolean }) => {\n  const [selected, setSelected] = useState<string | null>(null);\n  const currentMime = mime;\n  const isCandidate = enabled;\n  \n  useEffect(() => {\n    \n    if (isCandidate && currentMime && supportsClip(currentMime)) setSelected(source);\n  }, [isCandidate, currentMime, source, check]);\n  return <video data-selected={selected === source} />;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-browser-guard-0",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "react": "18.2.0"\n  }\n}\n',
      "tsconfig.json":
        '{\n  "compilerOptions": {\n    "jsx": "react-jsx",\n    "strict": true,\n    "module": "ESNext",\n    "target": "ES2020",\n    "lib": [\n      "DOM",\n      "ESNext"\n    ]\n  }\n}\n',
      "capability.js":
        'export function supportsClip(mime) {\n  if (typeof document === "undefined") return false;\n  return document.createElement("video").canPlayType(mime) !== "";\n}\n',
    },
    mutation: {
      file: "capability.ts",
      newContent: "export const supportsClip = (_mime: string) => true;\n",
    },
    expectedAdmissionBefore: true,
    expectedAdmissionAfter: false,
    requiredProbes: ["existence:capability.ts", "content:capability.js"],
    purpose:
      "Observed resolver tries .ts before .js for extensionless imports; cold+memo probes must retain earlier absent candidate. No fallback cache result reused as universal source proof.",
  },
];

describe("imported native media dependency transitions", () => {
  it.each(cacheTransitions)(
    "$name",
    ({
      initialFiles,
      mutation,
      expectedAdmissionBefore,
      expectedAdmissionAfter,
      requiredProbes,
    }) => {
      writeFixtureFiles(initialFiles);
      const filename = path.join(temporaryDirectory, "consumer.tsx");
      const sourceText = fs.readFileSync(filename, "utf8");
      const options = { ...cases[0].options, filename };
      const collect = () =>
        collectCrossFileDependencyProbes({
          absoluteFilePath: filename,
          sourceText,
          ruleIds: ["no-derived-state"],
        });
      const cold = collect();
      const memo = collect();
      expect(cold).not.toBeNull();
      expect(memo).toEqual(cold);
      for (const probe of requiredProbes) {
        const [kind, relativePath] = probe.split(":");
        const paths = kind === "content" ? cold?.contentPaths : cold?.existencePaths;
        expect(paths?.has(path.join(temporaryDirectory, relativePath))).toBe(true);
      }
      const fingerprint = () =>
        JSON.stringify({
          content: [...(cold?.contentPaths ?? [])]
            .sort()
            .map((filename) => [
              filename,
              fs.existsSync(filename) ? fs.readFileSync(filename, "utf8") : null,
            ]),
          existence: [...(cold?.existencePaths ?? [])]
            .sort()
            .map((filename) => [filename, fs.existsSync(filename)]),
        });
      const beforeFingerprint = fingerprint();
      const before = runRule(noDerivedState, sourceText, options);
      expect(before.parseErrors).toEqual([]);
      expect(before.diagnostics).toHaveLength(expectedAdmissionBefore ? 0 : 1);
      writeFixtureFiles({ [mutation.file]: mutation.newContent });
      expect(fingerprint()).not.toBe(beforeFingerprint);
      expect(fs.readFileSync(filename, "utf8")).toBe(sourceText);
      resetModuleFacts();
      const after = runRule(noDerivedState, sourceText, options);
      expect(after.parseErrors).toEqual([]);
      expect(after.diagnostics).toHaveLength(expectedAdmissionAfter ? 0 : 1);
    },
  );
});

describe("shared importer media dependency recording", () => {
  it("revalidates positive and negative providers while retaining one importer analysis", () => {
    const fixture = cases[0];
    if (!fixture) throw new Error("Expected the authored native importer");
    writeFixtureFiles({
      ...fixture.files,
      "consumer.tsx": fixture.code + "\nimport { unusedCapability } from './unused-helper';\n",
    });
    const filename = path.join(temporaryDirectory, "consumer.tsx");
    const code = fs.readFileSync(filename, "utf8");
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let effectFunction: EsTreeNode | null = null;
    let executionNode: EsTreeNode | null = null;
    let condition: EsTreeNode | null = null;
    walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "IfStatement")) condition = node.test;
      if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier")) return;
      if (node.callee.name === "setSelected") executionNode = node;
      const callback = node.arguments[0];
      if (
        node.callee.name === "useEffect" &&
        callback &&
        isNodeOfType(callback, "ArrowFunctionExpression")
      )
        effectFunction = callback;
    });
    if (!effectFunction || !executionNode || !condition)
      throw new Error("Expected the authored conditional state write");
    const selectedEffect = effectFunction;
    const selectedExecution = executionNode;
    const selectedCondition = condition;
    const context: RuleContext = {
      scopes,
      cfg: analyzeControlFlow(parsed.program),
      filename,
      settings: fixture.options.settings,
      sourceCode: { ast: parsed.program, getText: () => code },
      report: () => {},
    };
    const nativeProvider =
      'export const supportsClip = (mime) => document.createElement("video").canPlayType(mime) !== "";\n';
    const pureProvider = 'export const supportsClip = (mime) => mime.startsWith("video/");\n';
    const phases = [
      {
        name: "native",
        file: "capability.ts",
        content: nativeProvider,
        remove: null,
        admitted: true,
        contentProbe: "capability.ts",
      },
      {
        name: "warm-native",
        file: null,
        content: null,
        remove: null,
        admitted: true,
        contentProbe: "capability.ts",
      },
      {
        name: "pure",
        file: "capability.ts",
        content: pureProvider,
        remove: null,
        admitted: false,
        contentProbe: "capability.ts",
      },
      {
        name: "restored-native",
        file: "capability.ts",
        content: nativeProvider,
        remove: null,
        admitted: true,
        contentProbe: "capability.ts",
      },
      {
        name: "deleted",
        file: null,
        content: null,
        remove: "capability.ts",
        admitted: false,
        contentProbe: null,
      },
      {
        name: "js-fallback",
        file: "capability.js",
        content: nativeProvider,
        remove: null,
        admitted: true,
        contentProbe: "capability.js",
      },
      {
        name: "ts-shadow",
        file: "capability.ts",
        content: pureProvider,
        remove: null,
        admitted: false,
        contentProbe: "capability.ts",
      },
      {
        name: "restored-js-fallback",
        file: null,
        content: null,
        remove: "capability.ts",
        admitted: true,
        contentProbe: "capability.js",
      },
    ];
    const collect = () =>
      captureCrossFileProbes(() =>
        Boolean(
          createImportedNativeMediaGuardPredicate({
            context,
            effectFunction: selectedEffect,
            executionNode: selectedExecution,
          })?.(selectedCondition),
        ),
      );
    for (const phase of phases) {
      if (phase.file !== null && phase.content !== null)
        writeFixtureFiles({ [phase.file]: phase.content });
      if (phase.remove !== null) fs.rmSync(path.join(temporaryDirectory, phase.remove));
      resetModuleFacts();
      const first = collect();
      const repeated = collect();
      expect(first.value, phase.name).toBe(phase.admitted);
      expect(repeated.value, phase.name).toBe(phase.admitted);
      expect(repeated.trace, phase.name).toEqual(first.trace);
      expect(
        first.trace.existencePaths.has(path.join(temporaryDirectory, "unused-helper.ts")),
        phase.name,
      ).toBe(true);
      expect(
        first.trace.existencePaths.has(path.join(temporaryDirectory, "capability.ts")),
        phase.name,
      ).toBe(true);
      if (phase.contentProbe !== null)
        expect(
          first.trace.contentPaths.has(path.join(temporaryDirectory, phase.contentProbe)),
          phase.name,
        ).toBe(true);
      expect(context.scopes).toBe(scopes);
      expect(fs.readFileSync(filename, "utf8")).toBe(code);
    }
  });
});

for (const resetKind of ["resolution", "filesystem", "export"]) {
  for (const initiallyAccepted of [false, true]) {
    for (const recording of [false, true]) {
      it(`refreshes ${initiallyAccepted ? "accepted" : "refused"} media proofs after ${resetKind} resets with recording ${recording}`, () => {
        const fixture = cases[0];
        if (!fixture) throw new Error("Expected the authored native importer");
        writeFixtureFiles(fixture.files);
        const nativeProvider =
          'export const supportsClip = (mime) => document.createElement("video").canPlayType(mime) !== "";\n';
        const pureProvider = 'export const supportsClip = (mime) => mime.startsWith("video/");\n';
        const providerFilename = path.join(temporaryDirectory, "capability.ts");
        const relocatedFilename = path.join(temporaryDirectory, "relocated.ts");
        writeFixtureFiles({ "capability.js": nativeProvider });
        const setProvider = (accepted: boolean): void => {
          if (resetKind !== "resolution")
            fs.writeFileSync(providerFilename, accepted ? nativeProvider : pureProvider);
          else if (accepted) {
            if (fs.existsSync(providerFilename)) fs.renameSync(providerFilename, relocatedFilename);
          } else fs.writeFileSync(providerFilename, pureProvider);
        };
        setProvider(initiallyAccepted);
        resetFilesystemCaches();
        const parsed = parseFixture(fixture.code);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        let effectFunction: EsTreeNode | null = null;
        let executionNode: EsTreeNode | null = null;
        let condition: EsTreeNode | null = null;
        walkAst(parsed.program, (node) => {
          if (isNodeOfType(node, "IfStatement")) condition = node.test;
          if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier"))
            return;
          if (node.callee.name === "setSelected") executionNode = node;
          const callback = node.arguments[0];
          if (
            node.callee.name === "useEffect" &&
            callback &&
            isNodeOfType(callback, "ArrowFunctionExpression")
          )
            effectFunction = callback;
        });
        if (!effectFunction || !executionNode || !condition)
          throw new Error("Expected the authored conditional state write");
        const selectedEffect = effectFunction;
        const selectedExecution = executionNode;
        const selectedCondition = condition;
        const context: RuleContext = {
          scopes,
          cfg: analyzeControlFlow(parsed.program),
          filename: path.join(temporaryDirectory, "consumer.tsx"),
          settings: fixture.options.settings,
          sourceCode: { ast: parsed.program, getText: () => fixture.code },
          report: () => {},
        };
        const evaluate = (): boolean =>
          Boolean(
            createImportedNativeMediaGuardPredicate({
              context,
              effectFunction: selectedEffect,
              executionNode: selectedExecution,
            })?.(selectedCondition),
          );
        for (const accepted of [initiallyAccepted, !initiallyAccepted, initiallyAccepted]) {
          setProvider(accepted);
          if (resetKind === "resolution") resetModuleResolutionCaches();
          else if (resetKind === "export") resetCrossFileExportCaches();
          else resetFilesystemCaches();
          if (recording) {
            const cold = captureCrossFileProbes(evaluate);
            const warm = captureCrossFileProbes(evaluate);
            expect(cold.value).toBe(accepted);
            expect(warm.value).toBe(accepted);
            expect(warm.trace).toEqual(cold.trace);
          } else {
            expect(evaluate()).toBe(accepted);
            expect(evaluate()).toBe(accepted);
          }
        }
        expect(context.scopes).toBe(scopes);
        expect(fs.readFileSync(context.filename ?? "", "utf8")).toBe(fixture.code);
      });
    }
  }
}
