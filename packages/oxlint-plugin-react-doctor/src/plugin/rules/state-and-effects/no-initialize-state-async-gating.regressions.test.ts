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

        const getMoreTrashFiles = useCallback(async () => {});
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
});
