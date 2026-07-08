import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsTosortedImmutable } from "./js-tosorted-immutable.js";

const expectFail = (code: string): void => {
  const result = runRule(jsTosortedImmutable, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsTosortedImmutable, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-tosorted-immutable — regressions", () => {
  it("flags `[...arr].sort()` on a reused array binding", () => {
    expectFail(`const arr = getItems();\nconst s = [...arr].sort();`);
  });

  it("flags `[...props.items].sort()` on a member-expression receiver", () => {
    expectFail(`const s = [...props.items].sort();`);
  });

  it("does not flag spreading a freshly constructed `new Set(...)`", () => {
    expectPass(`const s = [...new Set(ids)].sort();`);
  });

  it("does not flag spreading an iterator (`map.values()`)", () => {
    expectPass(`const s = [...map.values()].sort();`);
  });

  it("flags an array-literal binding that is referenced elsewhere", () => {
    expectFail(`const arr = [3, 1, 2];\nrender(arr);\nconst s = [...arr].sort();\nrender(arr);`);
  });

  it("flags a parameter with an array-literal default (caller-supplied array)", () => {
    expectFail(`const sortItems = (items = []) => [...items].sort();`);
  });

  it("flags a `let` binding reassigned after a fresh init", () => {
    expectFail(`let arr = [];\narr = fetchRows();\nconst s = [...arr].sort();`);
  });

  it("flags a filter-result binding that is referenced elsewhere", () => {
    expectFail(
      `const visible = rows.filter(isVisible);\nrender(visible);\nconst s = [...visible].sort();`,
    );
  });

  it("flags a single-use fresh filter-result binding (doc: shape is the only fire condition)", () => {
    expectFail(`export const sortShown = (items) => {
      const shown = items.filter((item) => !item.hidden);
      return [...shown].sort((first, second) => first.id.localeCompare(second.id));
    };`);
  });

  it("flags a single-use filter binding spread before sort with [0] pick (calendar-invitation corpus shape)", () => {
    expectFail(`export const getInvitationActorSummary = (event) => {
      const participants = Object.values(event.participants);
      const attendees = participants.filter((participant) => !isOrganizerParticipant(participant));
      const respondingAttendee = [...attendees].sort((left, right) => (
        getParticipantSignalScore(right) - getParticipantSignalScore(left)
      ))[0] ?? null;
      return respondingAttendee;
    };`);
  });

  it("flags a single-use typed filter binding inside useMemo (SpanEventsSubpanel corpus shape)", () => {
    expectFail(`const sortedEvents = useMemo(() => {
      if (!spanEvents || spanEvents.length === 0) {
        return [];
      }
      const typedEvents = spanEvents.filter((event) => typeof event.Timestamp === 'string');
      return [...typedEvents].sort((a, b) => {
        const timeA = new Date(a.Timestamp).getTime();
        const timeB = new Date(b.Timestamp).getTime();
        return timeB - timeA;
      });
    }, [spanEvents]);`);
  });

  it("flags a single-use filter binding sorted with a status-order comparator (integrations-page corpus shape)", () => {
    expectFail(`const sortedIntegrations = useMemo(() => {
      const filtered = integrations.filter((item) => {
        const status = getIntegrationStatus(item);
        return matchesSearch(item) && status !== "hidden";
      });
      return [...filtered].sort((a, b) => {
        const aStatus = getIntegrationStatus(a);
        const bStatus = getIntegrationStatus(b);
        return statusOrder[aStatus] - statusOrder[bStatus];
      });
    }, [integrations, matchesSearch]);`);
  });

  it("flags a single-use filter binding on a nullish-coalesced source (agents-dashboard corpus shape)", () => {
    expectFail(`const sortedDirectoryItems = useMemo(() => {
      const filtered = (directoryItems ?? []).filter(matchesSearch);
      return [...filtered].sort((a, b) => compareAgentItemsBySort(a, b, sortBy));
    }, [directoryItems, matchesSearch, sortBy]);`);
  });

  it("does not flag a single-use binding initialized from an iterator-producing call", () => {
    expectPass(`const sortEntries = (registry) => {
      const entries = registry.values();
      return [...entries].sort();
    };`);
  });

  // Accepted heuristic tradeoff: a direct call expression whose method NAME
  // matches the fresh-array allowlist is exempt regardless of receiver.
  it("does not flag a direct name-only fresh-array method call receiver", () => {
    expectPass(`const s = [...registry.from(key)].sort();`);
  });

  it("does not flag a shared Set binding (spread is a required conversion)", () => {
    expectPass(`const quickPicks = (sessions) => {
      const paths = new Set();
      for (const s of sessions) {
        if (s.root) paths.add(s.root);
      }
      return [...paths].sort();
    };`);
  });

  it("does not flag a Set binding mutated between init and sort", () => {
    expectPass(`const run = (filterValue, filterCache) => {
      const set = new Set(filterCache.meta.nodesUnordered);
      removeBucketFromSet(filterValue, filterCache, set);
      return [...set].sort(sortByIds);
    };`);
  });

  it("does not flag a spread source whose `.size` is read nearby", () => {
    expectPass(`const copyRows = () => {
      if (selectedKeysRef.current.size > 0) {
        const sorted = [...selectedKeysRef.current].sort((a, b) => a - b);
        return sorted;
      }
    };`);
  });

  it("still flags a shared `new Array(...)` binding", () => {
    expectFail(`const arr = new Array(5);
      fill(arr);
      const s = [...arr].sort();`);
  });
});
