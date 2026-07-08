import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSelfUpdatingEffect } from "./no-self-updating-effect.js";

// docs-validation FP wave (0 TP / 7 FP): every confirmed FP was one of the
// doc's two ACCEPTED unprovable-but-converging cases — a `.map()` functional
// updater, an updater that can return its own parameter (settles by
// Object.is), or an equality/bound-guarded grow-by-one write. The doc
// instructs reviewers to suppress these; the rule now does it structurally.

describe("no-self-updating-effect — accepted converging updaters stay quiet", () => {
  it("stays silent on a queue-worker .map updater behind pre-write early returns (portos VideoGen)", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `function VideoGen() {
        const [queue, setQueue] = useState([]);
        const [runningQueueId, setRunningQueueId] = useState(null);
        const [generating, setGenerating] = useState(false);
        useEffect(() => {
          if (generating || runningQueueId) return;
          const next = queue.find((item) => item.status === 'pending');
          if (!next) return;
          setRunningQueueId(next.id);
          setQueue((q) => q.map((item) => item.id === next.id ? { ...item, status: 'running', startedAt: Date.now() } : item));
          runGeneration(next.params).then((res) => {
            setQueue((q) => q.map((item) => item.id === next.id ? { ...item, status: 'complete', result: res } : item));
          });
        }, [queue, generating, runningQueueId]);
        return <div data-count={queue.length} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a stale-deletion updater that returns prev unchanged (freecut)", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `function usePreviewMediaResolution() {
        const [resolvedUrls, setResolvedUrls] = useState(new Map());
        useEffect(() => {
          if (resolvedUrls.size === 0) {
            return;
          }
          const staleMediaIds = [];
          for (const [mediaId, resolvedUrl] of resolvedUrls.entries()) {
            if (blobUrlManager.get(mediaId) !== resolvedUrl) staleMediaIds.push(mediaId);
          }
          if (staleMediaIds.length === 0) {
            return;
          }
          setResolvedUrls((prevUrls) => {
            const nextUrls = new Map(prevUrls);
            let changed = false;
            for (const mediaId of staleMediaIds) {
              if (nextUrls.delete(mediaId)) {
                changed = true;
              }
            }
            return changed ? nextUrls : prevUrls;
          });
        }, [resolvedUrls]);
        return resolvedUrls;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a grow-by-one updater bounded by a relational early-return guard (tracecat SettingsModal)", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `function SettingsModal({ contextWorkspaceId, orderedFallbackWorkspaces, scopesLoading, canAdministerWorkspace, workspaceId }) {
        const [fallbackWorkspaceIndex, setFallbackWorkspaceIndex] = useState(0);
        useEffect(() => {
          if (
            contextWorkspaceId ||
            !workspaceId ||
            scopesLoading ||
            canAdministerWorkspace ||
            fallbackWorkspaceIndex >= orderedFallbackWorkspaces.length - 1
          ) {
            return;
          }
          setFallbackWorkspaceIndex((currentIndex) => currentIndex + 1);
        }, [canAdministerWorkspace, contextWorkspaceId, fallbackWorkspaceIndex, orderedFallbackWorkspaces.length, scopesLoading, workspaceId]);
        return <div data-i={fallbackWorkspaceIndex} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a clamp updater that returns the same reference once settled (tracecat ChatSessionPane)", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `function ChatSessionPane({ filteredToolSuggestions }) {
        const [toolMention, setToolMention] = useState();
        useEffect(() => {
          if (!toolMention) {
            return;
          }
          if (filteredToolSuggestions.length === 0) {
            setToolMention((current) => {
              if (!current || current.activeIndex === 0) {
                return current;
              }
              return { ...current, activeIndex: 0 };
            });
            return;
          }
          setToolMention((current) => {
            if (!current) {
              return current;
            }
            const clampedIndex = Math.min(current.activeIndex, filteredToolSuggestions.length - 1);
            if (clampedIndex === current.activeIndex) {
              return current;
            }
            return { ...current, activeIndex: clampedIndex };
          });
        }, [filteredToolSuggestions.length, toolMention]);
        return <div data-active={toolMention?.activeIndex} />;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("no-self-updating-effect — diverging updaters keep firing", () => {
  it("still flags an increment updater whose only guard is a nullish equality the write never establishes", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `function Counter() {
        const [x, setX] = useState(0);
        useEffect(() => {
          if (x === null) {
            return;
          }
          setX((value) => value + 1);
        }, [x]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an increment updater when the relational guard reads unrelated state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `function Counter({ limit }) {
        const [other, setOther] = useState(0);
        const [x, setX] = useState(0);
        useEffect(() => {
          if (other >= limit) {
            return;
          }
          setX((value) => value + 1);
        }, [x, other, limit]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an appending updater that never returns its own parameter", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `function List({ x }) {
        const [items, setItems] = useState([x]);
        useEffect(() => {
          if (!items.length) {
            return;
          }
          setItems((prev) => [...prev, x]);
        }, [items, x]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an updater rebuilt through a free function call on the parameter", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `function CreateRecordModal({ allFields }) {
        const [record, setRecord] = useState(null);
        useEffect(() => {
          if (!allFields.length) {
            return;
          }
          setRecord((current) => mapRecord(current, allFields));
        }, [allFields, record]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
