import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { evaluateProject, evaluateSource, evaluateVirtualProject } from "./evaluate-source.js";
import { createRealFilesystemResourceHost } from "./resource-host/real-resource-host.js";

const DERIVED_STATE_RULE_IDS = [
  "no-adjust-state-on-prop-change",
  "no-derived-state",
  "no-derived-state-effect",
  "no-initialize-state",
];

const PROJECT_FILES = new Map<string, string>([
  [
    "src/helpers/derive-label.ts",
    `export const deriveLabel = (value) => value.trim();
export const selectVisible = (versions) =>
  versions.filter((version) => version.visible);`,
  ],
  ["src/helpers/index.ts", `export { deriveLabel, selectVisible } from "./derive-label";`],
  [
    "src/effect-copy.tsx",
    `import { deriveLabel } from "./helpers";\r
\r
export const EffectCopy = ({ value }) => {\r
  "🧭";\r
  const [label, setLabel] = useState("");\r
  useEffect(() => {\r
    setLabel(deriveLabel(value));\r
  }, [value]);\r
  return <output>{label}</output>;\r
};`,
  ],
  [
    "src/mount-copy.tsx",
    `import { deriveLabel } from "./helpers";

export const MountCopy = ({ value }) => {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(deriveLabel(value));
  }, []);
  return <output>{label}</output>;
};`,
  ],
  [
    "src/selection-repair.tsx",
    `import { selectVisible } from "./helpers";

export const SelectionRepair = ({ versions }) => {
  const visibleVersions = useMemo(() => selectVisible(versions), [versions]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  useEffect(() => {
    if (visibleVersions.some((version) => version.id === selectedVersionId)) return;
    setSelectedVersionId(visibleVersions[0].id);
  }, [visibleVersions]);
  return (
    <VersionList
      versions={visibleVersions}
      selectedVersionId={selectedVersionId}
      onSelect={setSelectedVersionId}
    />
  );
};`,
  ],
  [
    "src/prop-adjustment.tsx",
    `export const PropAdjustment = ({ versions }) => {
  const visibleVersions = useMemo(
    () => versions.filter((version) => version.visible),
    [versions],
  );
  const [selectedVersionId, setSelectedVersionId] = useState("");
  useEffect(() => {
    if (visibleVersions.some((version) => version.id === selectedVersionId)) return;
    setSelectedVersionId(visibleVersions[0].id);
  }, [visibleVersions]);
  return (
    <VersionList
      versions={visibleVersions}
      selectedVersionId={selectedVersionId}
      onSelect={setSelectedVersionId}
    />
  );
};`,
  ],
  [
    "src/external-value.tsx",
    `import { deriveExternal } from "./unsafe-helper";

export const ExternalValue = ({ value }) => {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(deriveExternal(value)), [value]);
  return <output>{label}</output>;
};`,
  ],
  ["src/unsafe-helper.ts", `export const deriveExternal = (value) => readExternal(value);`],
  [
    "src/missing-helper.tsx",
    `import { deriveMissing } from "./absent-helper";

export const MissingHelper = ({ value }) => {
  const [label, setLabel] = useState("");
  useEffect(() => setLabel(deriveMissing(value)), [value]);
  return <output>{label}</output>;
};`,
  ],
  ["src/invalid.tsx", "export const ="],
]);

const temporaryDirectories: string[] = [];

describe("derived-state project evaluation", () => {
  afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps imported helper provenance exactly aligned", () => {
    const temporaryRootDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-evaluate-derived-state-"),
    );
    temporaryDirectories.push(temporaryRootDirectory);
    for (const [filename, sourceText] of PROJECT_FILES) {
      const absoluteFilename = path.join(temporaryRootDirectory, filename);
      fs.mkdirSync(path.dirname(absoluteFilename), { recursive: true });
      fs.writeFileSync(absoluteFilename, sourceText, "utf8");
    }

    const realResult = evaluateProject({
      files: PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: temporaryRootDirectory,
      }),
      ruleIds: DERIVED_STATE_RULE_IDS,
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-derived-state-project",
      files: PROJECT_FILES,
      ruleIds: DERIVED_STATE_RULE_IDS,
    });

    expect(virtualResult).toEqual(realResult);
    expect(
      virtualResult.diagnostics.map(
        ({ filePath, rule, message, line, column, offset, length, endLine, endColumn }) => ({
          filePath,
          rule,
          message,
          line,
          column,
          offset,
          length,
          endLine,
          endColumn,
        }),
      ),
    ).toEqual([
      {
        filePath: "src/effect-copy.tsx",
        rule: "no-derived-state-effect",
        message: "You pay an extra render for state you can derive from other values.",
        line: 6,
        column: 3,
        offset: 144,
        length: 67,
        endLine: 8,
        endColumn: 14,
      },
      {
        filePath: "src/effect-copy.tsx",
        rule: "no-derived-state",
        message:
          'Storing "label" in state when you can derive it from other values costs an extra render.',
        line: 7,
        column: 5,
        offset: 167,
        length: 28,
        endLine: 7,
        endColumn: 33,
      },
      {
        filePath: "src/mount-copy.tsx",
        rule: "no-derived-state-effect",
        message: "You pay an extra render for state you can derive from other values.",
        line: 5,
        column: 3,
        offset: 128,
        length: 60,
        endLine: 7,
        endColumn: 9,
      },
      {
        filePath: "src/mount-copy.tsx",
        rule: "no-derived-state",
        message:
          'Storing "label" in state when you can derive it from other values costs an extra render.',
        line: 6,
        column: 5,
        offset: 150,
        length: 28,
        endLine: 6,
        endColumn: 33,
      },
      {
        filePath: "src/mount-copy.tsx",
        rule: "no-initialize-state",
        message:
          'Your users see an extra render with empty "label" because a useEffect sets its starting value.',
        line: 6,
        column: 5,
        offset: 150,
        length: 28,
        endLine: 6,
        endColumn: 33,
      },
      {
        filePath: "src/prop-adjustment.tsx",
        rule: "no-adjust-state-on-prop-change",
        message:
          "This effect adjusts state after a prop changes, so users briefly see the stale value.",
        line: 9,
        column: 5,
        offset: 338,
        length: 43,
        endLine: 9,
        endColumn: 48,
      },
    ]);
    expect(virtualResult.failures).toEqual([
      {
        kind: "parse",
        filePath: "src/invalid.tsx",
        message: "Unexpected token",
        line: 1,
        column: 14,
        offset: 13,
        length: 1,
      },
    ]);
    expect(
      virtualResult.diagnostics.filter((diagnostic) =>
        ["src/selection-repair.tsx", "src/external-value.tsx", "src/missing-helper.tsx"].includes(
          diagnostic.filePath,
        ),
      ),
    ).toEqual([]);
  });

  it("keeps source-only evaluation explicitly unsupported", () => {
    expect(
      evaluateSource({
        sourceText: `const label = deriveLabel(value);`,
        filename: "src/component.tsx",
        ruleIds: DERIVED_STATE_RULE_IDS,
      }),
    ).toEqual({
      diagnostics: [],
      failures: DERIVED_STATE_RULE_IDS.map((rule) => ({
        kind: "unsupported-rule",
        filePath: "src/component.tsx",
        rule,
        message: `Rule requires a project host: ${rule}`,
      })),
    });
  });
});
