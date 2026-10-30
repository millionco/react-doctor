import { describe, expect, it } from "vite-plus/test";
import { exhaustiveDeps } from "./exhaustive-deps.js";
import { attachParentReferences } from "../../utils/attach-parent-references.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getNodeEndIndex } from "../../utils/get-node-end-index.js";
import type { ReportDescriptor } from "../../utils/report-descriptor.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { attachSourceLocations } from "../../../test-utils/attach-source-locations.js";

const expectedDescriptors = {
  "direct-readonly-member-alias": [],
  "direct-member-dependency": [],
  "omitted-member": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 239,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 57,
        },
      },
      source: "[]",
    },
  ],
  "second-field-omitted": [
    {
      message:
        "`useMemo` can run with a stale `settings.labels, settings.locale` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 254,
      end: 270,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "wrong-root-binding": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 234,
      end: 250,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "shadowed-root-binding": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 263,
      end: 279,
      loc: {
        start: {
          line: 5,
          column: 81,
        },
        end: {
          line: 5,
          column: 97,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "mutable-alias": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 267,
      end: 283,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "source-alias-write": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 309,
      end: 325,
      loc: {
        start: {
          line: 7,
          column: 55,
        },
        end: {
          line: 7,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "member-assignment": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 270,
      end: 286,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "root-assignment": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 257,
      end: 273,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "delete-member": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 263,
      end: 279,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "object-assign": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 271,
      end: 287,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "opaque-root-escape": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 259,
      end: 275,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "member-method-mutation": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 274,
      end: 290,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "intervening-ordinary-call": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 253,
      end: 269,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "alias-after-hook": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 195,
      end: 211,
      loc: {
        start: {
          line: 4,
          column: 55,
        },
        end: {
          line: 4,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "conditional-alias": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 252,
      end: 268,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "getter-local-root": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 295,
      end: 311,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "proxy-local-root": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 272,
      end: 288,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "jsx-getter-caller": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "jsx-proxy-caller": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "direct-owner-caller": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "owner-escape": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "computed-member": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 240,
      end: 256,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "optional-member": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 238,
      end: 254,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "boolean-transform": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 246,
      end: 262,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "fresh-fallback": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 243,
      end: 259,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "stable-fallback": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 278,
      end: 294,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "conditional-transform": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 295,
      end: 311,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "duplicate-alias-dependency": [
    {
      message:
        "`useMemo` lists `labelsSnapshot` twice, adding dependency-array noise without changing when it runs.",
      nodeType: "Identifier",
      start: 254,
      end: 268,
      loc: {
        start: {
          line: 5,
          column: 72,
        },
        end: {
          line: 5,
          column: 86,
        },
      },
      source: "labelsSnapshot",
    },
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 269,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 87,
        },
      },
      source: "[labelsSnapshot, labelsSnapshot]",
    },
  ],
  "extra-unrelated-dependency": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 260,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 78,
        },
      },
      source: "[labelsSnapshot, other]",
    },
  ],
  "multi-alias-declarators": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 261,
      end: 277,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "multi-hook-declarators": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 261,
      end: 277,
      loc: {
        start: {
          line: 5,
          column: 79,
        },
        end: {
          line: 5,
          column: 95,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "namespace-provider-replacement": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 298,
      end: 314,
      loc: {
        start: {
          line: 7,
          column: 55,
        },
        end: {
          line: 7,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "default-provider-replacement": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 293,
      end: 309,
      loc: {
        start: {
          line: 7,
          column: 55,
        },
        end: {
          line: 7,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "named-provider-replacement": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 260,
      end: 276,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "type-only-provider": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 242,
      end: 258,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "fake-provider": [],
  "local-provider": [],
  "faithful-direct-alias": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "actually-absent-mode-direct-alias": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "faithful-direct-member": [],
  "actually-absent-mode-direct-member": [],
  "wholly-absent-settings-direct-alias": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "explicit-upstream-direct-alias": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "explicit-unknown-direct-alias": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "alias-render-escape": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "root-after-hook-escape": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "helper-exported": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 244,
      end: 260,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "helper-escaped": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "helper-computed": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 240,
      end: 256,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "helper-optional": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 238,
      end: 254,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "helper-transform": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 246,
      end: 262,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "helper-extra-work": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 263,
      end: 279,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "helper-async": [
    {
      message: "`useMemo` can run with a stale `settings` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 243,
      end: 259,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "callback-default-parameter": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 257,
      end: 273,
      loc: {
        start: {
          line: 5,
          column: 75,
        },
        end: {
          line: 5,
          column: 91,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "dynamic-scope": [
    {
      message: "`useMemo` can run with a stale `settings` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 261,
      end: 277,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "hook-extra-argument": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 237,
      end: 253,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "helper-extra-argument": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 251,
      end: 267,
      loc: {
        start: {
          line: 5,
          column: 69,
        },
        end: {
          line: 5,
          column: 85,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "alias-chain": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 276,
      end: 292,
      loc: {
        start: {
          line: 6,
          column: 55,
        },
        end: {
          line: 6,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
  "named-owner-inner-escape": [
    {
      message: "`useMemo` can run with a stale `settings.labels` & show your users old data.",
      nodeType: "ArrayExpression",
      start: 256,
      end: 272,
      loc: {
        start: {
          line: 5,
          column: 55,
        },
        end: {
          line: 5,
          column: 71,
        },
      },
      source: "[labelsSnapshot]",
    },
  ],
};

const cases = [
  {
    name: "direct-readonly-member-alias",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "one-nominated-missing-removal-only",
    expectedCount: 0,
    settingsForm: "present",
  },
  {
    name: "direct-member-dependency",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [settings.labels]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    expectedCount: 0,
    settingsForm: "present",
  },
  {
    name: "omitted-member",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), []);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    expectedCount: 1,
    settingsForm: "present",
  },
  {
    name: "second-field-omitted",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => [source.labels, source.locale];\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "wrong-root-binding",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = other.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "shadowed-root-binding",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  { const settings = other; const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  }\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "mutable-alias",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  let labelsSnapshot = settings.labels;\n  labelsSnapshot = replacement;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "source-alias-write",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const mutableSource = settings;\n  const labelsSnapshot = settings.labels;\n  mutableSource.labels = replacement;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "member-assignment",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  settings.labels = replacement;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "root-assignment",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  settings = other;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "delete-member",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  delete settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "object-assign",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  Object.assign(settings, other);\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "opaque-root-escape",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  sendAway(settings);\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "member-method-mutation",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  settings.labels.push(replacement);\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "intervening-ordinary-call",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  sideEffect();\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "alias-after-hook",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  const labelsSnapshot = settings.labels;\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "conditional-alias",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  if (other) { const labelsSnapshot = settings.labels; }\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "getter-local-root",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  settings = { get labels() { return createLabels(); } };\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "proxy-local-root",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  settings = new Proxy(other, {});\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "jsx-getter-caller",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};\nconst Parent = () => <Panel settings={{ get labels() { return createLabels(); } }} />;',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "jsx-proxy-caller",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};\nconst Parent = () => <Panel settings={new Proxy({}, {})} />;',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "direct-owner-caller",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};\nPanel({ settings: { get labels() { return createLabels(); } } });',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "owner-escape",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};\nsendAway(Panel);',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "computed-member",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings["labels"];\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "optional-member",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings?.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "boolean-transform",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = Boolean(settings.labels);\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "fresh-fallback",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels || [];\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "stable-fallback",
    code: 'const EMPTY_LABELS = [];\nimport { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels ?? EMPTY_LABELS;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "conditional-transform",
    code: 'const EMPTY_LABELS = [];\nimport { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels ? settings.labels : EMPTY_LABELS;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "duplicate-alias-dependency",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot, labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "extra-unrelated-dependency",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot, other]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "multi-alias-declarators",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels, ignored = sideEffect();\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "multi-hook-declarators",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const ignored = sideEffect(), selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "namespace-provider-replacement",
    code: 'import * as React from "react";\nReact.useMemo = replacement;\nimport { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "default-provider-replacement",
    code: 'import React from "react";\nReact.useMemo = replacement;\nimport { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "named-provider-replacement",
    code: 'import { useMemo } from "react";\nuseMemo = replacement;\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "type-only-provider",
    code: 'import type { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "fake-provider",
    code: 'import { useMemo } from "other-package";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "local-provider",
    code: "const useMemo = otherMemo;\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};",
    mode: "curated",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "faithful-direct-alias",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "faithful",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "actually-absent-mode-direct-alias",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: null,
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "faithful-direct-member",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [settings.labels]);\n  return null;\n};',
    mode: "faithful",
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "actually-absent-mode-direct-member",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [settings.labels]);\n  return null;\n};',
    mode: null,
    plannedDisposition: "retain-baseline",
    settingsForm: "present",
  },
  {
    name: "wholly-absent-settings-direct-alias",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: null,
    settingsForm: "absent",
    plannedDisposition: "retain-baseline",
    expectedCount: 1,
  },
  {
    name: "explicit-upstream-direct-alias",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "upstream",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
    expectedCount: 1,
  },
  {
    name: "explicit-unknown-direct-alias",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "unknown",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
    expectedCount: 1,
  },
  {
    name: "alias-render-escape",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  sendAway(labelsSnapshot);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "root-after-hook-escape",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  sendAway(settings);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "helper-exported",
    code: 'import { useMemo } from "react";\nexport const readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "helper-escaped",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};\nsendAway(readLabels);',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "helper-computed",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source["labels"];\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "helper-optional",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source?.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "helper-transform",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => Boolean(source.labels);\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "helper-extra-work",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => { sideEffect(); return source.labels; };\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "helper-async",
    code: 'import { useMemo } from "react";\nconst readLabels = async (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "callback-default-parameter",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo((value = sideEffect()) => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "dynamic-scope",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  eval("sideEffect()");\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "hook-extra-argument",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot], sideEffect());\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "helper-extra-argument",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings, sideEffect()), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "alias-chain",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = ({ settings, other, replacement }) => {\n  const firstSnapshot = settings.labels;\n  const labelsSnapshot = firstSnapshot;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
  {
    name: "named-owner-inner-escape",
    code: 'import { useMemo } from "react";\nconst readLabels = (source) => source.labels;\nexport const Panel = function InternalPanel({ settings, other, replacement }) {\n  const labelsSnapshot = settings.labels;\n  const selected = useMemo(() => readLabels(settings), [labelsSnapshot]);\n  schedule(() => InternalPanel({ settings: { get labels() { return createLabels(); } } }));\n  return null;\n};',
    mode: "curated",
    settingsForm: "present",
    plannedDisposition: "retain-baseline",
  },
];

describe("readonly direct member alias dependency coverage", () => {
  it.each(cases)("$name", (fixture) => {
    const parsed = parseFixture(fixture.code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    attachSourceLocations(parsed.program, fixture.code);
    const reports: ReportDescriptor[] = [];
    const visitors = wrapWithSemanticContext(exhaustiveDeps).create({
      filename: "invented-baseline.tsx",
      ...(fixture.settingsForm === "absent"
        ? {}
        : {
            settings: {
              "react-doctor": { ...(fixture.mode ? { portedRuleMode: fixture.mode } : {}) },
            },
          }),
      report: (descriptor) => reports.push(descriptor),
    });
    visitors.Program?.(parsed.program);
    walkAst(parsed.program, (node) => {
      if (node.type === "CallExpression") visitors.CallExpression?.(node);
    });
    visitors["Program:exit"]?.(parsed.program);
    const descriptors = reports.map((descriptor) => ({
      message: descriptor.message,
      nodeType: descriptor.node.type,
      start: getNodeStartIndex(descriptor.node),
      end: getNodeEndIndex(descriptor.node),
      loc: descriptor.node.loc,
      source: fixture.code.slice(
        getNodeStartIndex(descriptor.node),
        getNodeEndIndex(descriptor.node),
      ),
    }));
    process.stdout.write(
      "CANDIDATE_ROW " +
        JSON.stringify({
          name: fixture.name,
          mode: fixture.mode,
          settingsForm: fixture.settingsForm,
          plannedDisposition: fixture.plannedDisposition,
          descriptors,
        }) +
        "\n",
    );
    expect(descriptors).toEqual(
      Object.entries(expectedDescriptors).find(([name]) => name === fixture.name)?.[1],
    );
    if (typeof fixture.expectedCount === "number")
      expect(descriptors).toHaveLength(fixture.expectedCount);
  });
});
