import { describe, expect, it } from "vite-plus/test";
import { applyOperationsToTree } from "../src/devtools/operations/apply-operations-to-tree.js";
import { takeTreeSnapshot } from "../src/devtools/operations/take-tree-snapshot.js";
import { assembleFrontendData } from "../src/devtools/operations/assemble-frontend-data.js";
import { serializeProfilingExport } from "../src/utils/serialize-profiling-export.js";
import { parseElementDisplayName } from "../src/utils/parse-element-display-name.js";
import type { DevtoolsElementTree } from "../src/types/element-tree.js";

const RENDERER_ID = 1;
const ROOT_ID = 1;
const ELEMENT_TYPE_FUNCTION = 5;
const ELEMENT_TYPE_ROOT = 11;

// Operations for: root(1) > App(2) > Child(3), encoded per the documented
// React DevTools operations format (string table + ADD opcodes).
const buildAddOperations = (): Array<number> => {
  const stringTable = [
    3,
    "A".codePointAt(0)!,
    "p".codePointAt(0)!,
    "p".codePointAt(0)!,
    5,
    "C".codePointAt(0)!,
    "h".codePointAt(0)!,
    "i".codePointAt(0)!,
    "l".codePointAt(0)!,
    "d".codePointAt(0)!,
  ];
  return [
    RENDERER_ID,
    ROOT_ID,
    stringTable.length,
    ...stringTable,
    // ADD root: op, id, type, isStrictModeCompliant, profilerFlags, supportsStrictMode, hasOwnerMetadata
    1,
    1,
    ELEMENT_TYPE_ROOT,
    1,
    1,
    0,
    0,
    // ADD App: op, id, type, parentID, ownerID, displayNameStringID(1="App"), keyStringID(0), namePropStringID(0)
    1,
    2,
    ELEMENT_TYPE_FUNCTION,
    1,
    0,
    1,
    0,
    0,
    // ADD Child: op, id, type, parentID(2), ownerID, displayNameStringID(2="Child"), key, nameProp
    1,
    3,
    ELEMENT_TYPE_FUNCTION,
    2,
    0,
    2,
    0,
    0,
  ];
};

describe("applyOperationsToTree", () => {
  it("reconstructs the element tree from ADD operations", () => {
    const tree: DevtoolsElementTree = new Map();
    const result = applyOperationsToTree(tree, buildAddOperations());

    expect(result.rendererID).toBe(RENDERER_ID);
    expect(result.rootID).toBe(ROOT_ID);
    expect(result.bailed).toBe(false);
    expect(tree.size).toBe(3);
    expect(tree.get(2)?.displayName).toBe("App");
    expect(tree.get(2)?.parentID).toBe(1);
    expect(tree.get(1)?.children).toEqual([2]);
    expect(tree.get(2)?.children).toEqual([3]);
    expect(tree.get(3)?.displayName).toBe("Child");
  });

  it("bails on unknown/variable-width opcodes without throwing", () => {
    const tree: DevtoolsElementTree = new Map();
    // valid string table (empty) + a Suspense opcode (8) we cannot size
    const result = applyOperationsToTree(tree, [RENDERER_ID, ROOT_ID, 0, 8, 99]);
    expect(result.bailed).toBe(true);
  });
});

describe("takeTreeSnapshot", () => {
  it("walks the tree into snapshot nodes", () => {
    const tree: DevtoolsElementTree = new Map();
    applyOperationsToTree(tree, buildAddOperations());
    const snapshots = takeTreeSnapshot(tree, ROOT_ID);

    expect([...snapshots.keys()]).toEqual([1, 2, 3]);
    expect(snapshots.get(2)?.displayName).toBe("App");
    expect(snapshots.get(2)?.children).toEqual([3]);
  });
});

describe("parseElementDisplayName", () => {
  it("unwraps the Forget compiler marker", () => {
    const parsed = parseElementDisplayName("Forget(App)", ELEMENT_TYPE_FUNCTION);
    expect(parsed.formattedDisplayName).toBe("App");
    expect(parsed.compiledWithForget).toBe(true);
  });

  it("splits HOC wrappers", () => {
    const parsed = parseElementDisplayName("withRouter(Page)", ELEMENT_TYPE_FUNCTION);
    expect(parsed.formattedDisplayName).toBe("Page");
    expect(parsed.hocDisplayNames).toEqual(["withRouter"]);
  });
});

describe("assembleFrontendData + serializeProfilingExport", () => {
  it("merges backend commit data with snapshots into a v5 export", () => {
    const tree: DevtoolsElementTree = new Map();
    const operations = buildAddOperations();
    applyOperationsToTree(tree, operations);

    const frontend = assembleFrontendData({
      dataBackend: {
        rendererID: RENDERER_ID,
        dataForRoots: [
          {
            rootID: ROOT_ID,
            displayName: "App",
            initialTreeBaseDurations: [[2, 1.5]],
            commitData: [
              {
                changeDescriptions: [
                  [
                    2,
                    {
                      context: null,
                      didHooksChange: false,
                      isFirstMount: true,
                      props: null,
                      state: null,
                    },
                  ],
                ],
                duration: 4.2,
                effectDuration: null,
                fiberActualDurations: [[2, 4.2]],
                fiberSelfDurations: [[2, 2.1]],
                passiveEffectDuration: null,
                priorityLevel: "Normal",
                timestamp: 10,
                updaters: null,
              },
            ],
          },
        ],
      },
      operationsByRootID: new Map([[ROOT_ID, [operations]]]),
      snapshotsByRootID: new Map([[ROOT_ID, takeTreeSnapshot(tree, ROOT_ID)]]),
    });

    const exported = serializeProfilingExport(frontend);

    expect(exported.version).toBe(5);
    expect(exported.dataForRoots).toHaveLength(1);
    const root = exported.dataForRoots[0]!;
    expect(root.rootID).toBe(ROOT_ID);
    expect(root.commitData[0]!.fiberActualDurations).toEqual([[2, 4.2]]);
    expect(root.snapshots.map(([id]) => id)).toEqual([1, 2, 3]);
    expect(root.operations).toHaveLength(1);
  });
});
