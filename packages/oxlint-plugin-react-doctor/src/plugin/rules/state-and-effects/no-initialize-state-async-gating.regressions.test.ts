import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInitializeState } from "./no-initialize-state.js";

describe("no-initialize-state — async gating regressions", () => {
  it("stays silent when a synchronous mount dispatcher selects an awaited remote loader", () => {
    const result = runRule(
      noInitializeState,
      `function useTrashPagination({ getTrashPaginated, isTrash }) {
        const [hasMoreTrashFolders, setHasMoreTrashFolders] = useState(true);

        useEffect(() => {
          if (isTrash) {
            getMoreTrashItems();
          }
        }, []);

        const getMoreTrashFolders = useCallback(async () => {
          if (getTrashPaginated) {
            const result = await getTrashPaginated();
            setHasMoreTrashFolders(!result.finished);
          }
        }, [getTrashPaginated]);

        const getMoreTrashFiles = useCallback(async () => {}, []);
        const getMoreTrashItems = useCallback(() => {
          return hasMoreTrashFolders ? getMoreTrashFolders() : getMoreTrashFiles();
        }, [hasMoreTrashFolders, getMoreTrashFolders, getMoreTrashFiles]);

        return hasMoreTrashFolders;
      }`,
      { filename: "use-trash-pagination.ts" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a render-known prop copy reached through one synchronous helper", () => {
    const result = runRule(
      noInitializeState,
      `function Profile({ initialName }) {
        const [name, setName] = useState("");
        const initializeName = () => {
          setName(initialName);
        };

        useEffect(() => {
          initializeName();
        }, []);

        return name;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on the same prop copy after the selected loader suspends", () => {
    const result = runRule(
      noInitializeState,
      `function Profile({ initialName, loadProfile }) {
        const [name, setName] = useState("");
        const loadName = async () => {
          await loadProfile();
          setName(initialName);
        };
        const initializeProfile = () => loadName();

        useEffect(() => {
          initializeProfile();
        }, []);

        return name;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
