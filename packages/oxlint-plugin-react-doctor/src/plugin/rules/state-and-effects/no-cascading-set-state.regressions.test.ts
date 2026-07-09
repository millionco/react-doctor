import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCascadingSetState } from "./no-cascading-set-state.js";

describe("state-and-effects/no-cascading-set-state — regressions: mined bug shapes stay detected", () => {
  it("stays silent when a variable-stored handler registered via addEventListener holds most setters (cookiekit CookieConsentContext shape)", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      export const CookieManager = ({ enableFloatingButton }: { enableFloatingButton: boolean }) => {
        const [isVisible, setIsVisible] = useState(false);
        const [showManageConsent, setShowManageConsent] = useState(false);
        const [isFloatingButtonVisible, setIsFloatingButtonVisible] = useState(false);
        const [detailedConsent] = useState<Record<string, unknown> | null>(null);
        useEffect(() => {
          if (enableFloatingButton && detailedConsent) {
            setIsFloatingButtonVisible(true);
          }
          const handleShowCookieConsent = () => {
            if (detailedConsent) {
              setShowManageConsent(true);
              setIsFloatingButtonVisible(false);
            } else {
              setIsVisible(true);
            }
          };
          window.addEventListener("show-cookie-consent", handleShowCookieConsent);
          return () => {
            window.removeEventListener("show-cookie-consent", handleShowCookieConsent);
          };
        }, [enableFloatingButton, detailedConsent]);
        return <div>{String(isVisible)}{String(showManageConsent)}{String(isFloatingButtonVisible)}</div>;
      };
    `,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an if/else ladder whose mutually-exclusive branches only co-run 2 setters (openfootmanager MatchSimulation shape, max-path semantics)", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      interface Team { id: string }
      interface Snapshot { home_team: Team; away_team: Team }
      export const MatchSimulation = ({ managerTeamId, matchMode }: { managerTeamId: string | null; matchMode: string }) => {
        const [snapshot] = useState<Snapshot | null>(null);
        const [userSide, setUserSide] = useState<"Home" | "Away" | null>(null);
        const [isSpectator, setIsSpectator] = useState(false);
        useEffect(() => {
          if (!snapshot) return;
          if (!managerTeamId) {
            setIsSpectator(true);
            return;
          }
          if (snapshot.home_team.id === managerTeamId) setUserSide("Home");
          else if (snapshot.away_team.id === managerTeamId) setUserSide("Away");
          else setIsSpectator(true);
          if (matchMode === "spectator") setIsSpectator(true);
        }, [snapshot, managerTeamId, matchMode]);
        return <div>{userSide}{String(isSpectator)}</div>;
      };
    `,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a synchronous forEach cascade", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      export const Sync = ({ items }: { items: number[] }) => {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        useEffect(() => {
          items.forEach(() => {
            setA(1);
            setB(2);
            setC(3);
          });
        }, [items]);
        return <div>{a}{b}{c}</div>;
      };
    `,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags 3 synchronous setters in the effect body", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      export const Init = ({ id }: { id: string }) => {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        useEffect(() => {
          setA(1);
          setB(2);
          setC(3);
        }, [id]);
        return <div>{a}{b}{c}</div>;
      };
    `,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("state-and-effects/no-cascading-set-state — regressions: FP-fix setter counting stays exact", () => {
  it("does not count setters inside a variable-stored listener handler (handlers fire on their own dispatch)", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      export const Multi = () => {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        useEffect(() => {
          const onResize = () => {
            setA(1);
            setB(2);
            setC(3);
          };
          window.addEventListener("resize", onResize);
          return () => window.removeEventListener("resize", onResize);
        });
        return <div>{a}{b}{c}</div>;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not over-count: one synchronous setter plus a one-setter registered handler stays under the threshold", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      export const Banner = ({ enabled }: { enabled: boolean }) => {
        const [isVisible, setIsVisible] = useState(false);
        const [isDismissed, setIsDismissed] = useState(false);
        useEffect(() => {
          if (enabled) setIsVisible(true);
          const handleDismiss = () => {
            setIsDismissed(true);
          };
          window.addEventListener("dismiss-banner", handleDismiss);
          return () => window.removeEventListener("dismiss-banner", handleDismiss);
        }, [enabled]);
        return <div>{String(isVisible)}{String(isDismissed)}</div>;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count setters that only run in the effect cleanup", () => {
    const result = runRule(
      noCascadingSetState,
      `
      import { useEffect, useState } from "react";
      export const Reset = ({ id }: { id: string }) => {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        useEffect(() => {
          return () => {
            setA(0);
            setB(0);
            setC(0);
          };
        }, [id]);
        return <div>{a}{b}{c}</div>;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("no-cascading-set-state — regressions", () => {
  it("stays silent on a stored listener handler beside a guarded setter (cookiekit CookieConsentContext)", () => {
    const result = runRule(
      noCascadingSetState,
      `function CookieManager({ enableFloatingButton, detailedConsent }) {
        const [isVisible, setIsVisible] = useState(false);
        const [showManageConsent, setShowManageConsent] = useState(false);
        const [isFloatingButtonVisible, setIsFloatingButtonVisible] = useState(false);
        useEffect(() => {
          if (enableFloatingButton && detailedConsent) {
            setIsFloatingButtonVisible(true);
          }
          const handleShowCookieConsent = () => {
            if (detailedConsent) {
              setShowManageConsent(true);
              setIsFloatingButtonVisible(false);
            } else {
              setIsVisible(true);
            }
          };
          window.addEventListener("show-cookie-consent", handleShowCookieConsent);
          return () => {
            window.removeEventListener("show-cookie-consent", handleShowCookieConsent);
          };
        }, [enableFloatingButton, detailedConsent]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an if/else setter ladder behind early-return guards — branches never co-run (openfootmanager MatchSimulation, max-path semantics)", () => {
    const result = runRule(
      noCascadingSetState,
      `function MatchSimulation({ gameState, snapshot, matchMode }) {
        const [userSide, setUserSide] = useState(null);
        const [isSpectator, setIsSpectator] = useState(false);
        useEffect(() => {
          if (!gameState || !snapshot) return;
          const utid = gameState.manager.team_id;
          if (!utid) {
            setIsSpectator(true);
            return;
          }
          if (snapshot.home_team.id === utid) setUserSide("Home");
          else if (snapshot.away_team.id === utid) setUserSide("Away");
          else setIsSpectator(true);
          if (matchMode === "spectator") setIsSpectator(true);
        }, [gameState, snapshot, matchMode]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a helper declared in the effect body and invoked synchronously", () => {
    const result = runRule(
      noCascadingSetState,
      `function Widget({ data }) {
        const [alpha, setAlpha] = useState(0);
        const [beta, setBeta] = useState(0);
        const [gamma, setGamma] = useState(0);
        useEffect(() => {
          const applyAll = () => {
            setAlpha(data.a);
            setBeta(data.b);
            setGamma(data.c);
          };
          applyAll();
        }, [data]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when setters split across a deferred subscription callback", () => {
    const result = runRule(
      noCascadingSetState,
      `function useAnswers({ store }) {
        const [query, setQuery] = useState("");
        const [index, setIndex] = useState("");
        const [isLoading, setIsLoading] = useState(false);
        useEffect(() => {
          setIndex(store.mainTargetedIndex);
          return store.subscribe(() => {
            const { widgets } = store.getState();
            setQuery(widgets.query);
            setIsLoading(false);
          });
        }, [store]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an early-return guard branch is exclusive with the post-guard body", () => {
    const result = runRule(
      noCascadingSetState,
      `function useAnswers({ query, search }) {
        const [isLoading, setIsLoading] = useState(false);
        const [hits, setHits] = useState([]);
        useEffect(() => {
          if (!query) {
            setIsLoading(false);
            setHits([]);
            return;
          }
          setIsLoading(true);
          search(query).then((result) => {
            if (!result) return;
            setIsLoading(false);
            setHits(result.hits);
          });
        }, [query, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for an async fetch effect whose setters straddle awaits", () => {
    const result = runRule(
      noCascadingSetState,
      `function Profile({ userId }) {
        const [status, setStatus] = useState("idle");
        const [data, setData] = useState(null);
        useEffect(() => {
          const load = async () => {
            setStatus("loading");
            const response = await fetch(userId);
            setData(response);
            setStatus("idle");
          };
          load();
        }, [userId]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a mount-only init effect regardless of setter count", () => {
    const result = runRule(
      noCascadingSetState,
      `function Form() {
        const [name, setName] = useState("");
        const [email, setEmail] = useState("");
        const [phone, setPhone] = useState("");
        useEffect(() => {
          setName(defaults.name);
          setEmail(defaults.email);
          setPhone(defaults.phone);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a component-level async useCallback helper whose setters run in a post-await continuation (portos AutobiographyTab, delta audit)", () => {
    const result = runRule(
      noCascadingSetState,
      `function useCityData({ api }) {
        const [apps, setApps] = useState([]);
        const [agents, setAgents] = useState([]);
        const [status, setStatus] = useState(null);
        const [loading, setLoading] = useState(true);
        const fetchAll = useCallback(async () => {
          const [appsData, agentsData, statusData] = await Promise.all([
            api.getApps(),
            api.getAgents(),
            api.getStatus(),
          ]);
          setApps(appsData);
          setAgents(agentsData);
          setStatus(statusData);
          setLoading(false);
        }, [api]);
        useEffect(() => {
          fetchAll();
        }, [fetchAll, api]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a helper invoked only from an async continuation (its setters batch after the await, delta audit)", () => {
    const result = runRule(
      noCascadingSetState,
      `function useAlbumDetail({ id, resolveAlbum }) {
        const [album, setAlbum] = useState(null);
        const [isStarred, setIsStarred] = useState(false);
        const [starredSongs, setStarredSongs] = useState(null);
        const [loading, setLoading] = useState(true);
        useEffect(() => {
          const applyAlbumPayload = (data) => {
            setAlbum(data);
            setIsStarred(Boolean(data.album.starred));
            setStarredSongs(data.songs);
            setLoading(false);
          };
          void (async () => {
            const local = await resolveAlbum(id);
            if (local) applyAlbumPayload(local);
          })();
        }, [id, resolveAlbum]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when async setters are separated by awaits even with several call sites (loading/data/idle straddle)", () => {
    const result = runRule(
      noCascadingSetState,
      `function useSearch({ query, search, count }) {
        const [status, setStatus] = useState("idle");
        const [hits, setHits] = useState([]);
        const [total, setTotal] = useState(0);
        useEffect(() => {
          void (async () => {
            setStatus("loading");
            const result = await search(query);
            setHits(result.hits);
            const totalCount = await count(query);
            setTotal(totalCount);
            setStatus("idle");
          })();
        }, [query, search, count]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when async fetch branches are mutually exclusive (appflowy FileBlock, delta audit)", () => {
    const result = runRule(
      noCascadingSetState,
      `function FileBlock({ readOnly, retryLocalUrl, fileHandler }) {
        const [localUrl, setLocalUrl] = useState(null);
        const [needRetry, setNeedRetry] = useState(false);
        useEffect(() => {
          if (readOnly) return;
          void (async () => {
            if (retryLocalUrl) {
              const fileData = await fileHandler.getStoredFile(retryLocalUrl);
              setLocalUrl(fileData?.url);
              setNeedRetry(!!fileData);
            } else {
              setNeedRetry(false);
            }
          })();
        }, [readOnly, retryLocalUrl, fileHandler]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the effect kicks off two independent async fetch helpers (portos ScheduleTab, delta audit)", () => {
    const result = runRule(
      noCascadingSetState,
      `function ScheduleTab({ api }) {
        const [schedule, setSchedule] = useState(null);
        const [providers, setProviders] = useState([]);
        const [loading, setLoading] = useState(true);
        const fetchSchedule = useCallback(async () => {
          const data = await api.getCosSchedule().catch(() => null);
          setSchedule(data);
          setLoading(false);
        }, []);
        const fetchProviders = useCallback(async () => {
          const data = await api.getProviders().catch(() => null);
          setProviders(data?.providers || []);
        }, []);
        useEffect(() => {
          fetchSchedule();
          fetchProviders();
        }, [fetchSchedule, fetchProviders]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when post-await success/failure branches straddle a trailing loading setter (portos DatadogTab, delta audit)", () => {
    const result = runRule(
      noCascadingSetState,
      `function DatadogTab({ api }) {
        const [errors, setErrors] = useState([]);
        const [loading, setLoading] = useState(true);
        const [fetchFailed, setFetchFailed] = useState(false);
        const fetchErrors = useCallback(async () => {
          setLoading(true);
          setFetchFailed(false);
          const result = await api.searchDatadogErrors().catch(() => null);
          if (result) {
            setErrors(result.data || []);
          } else {
            setFetchFailed(true);
          }
          setLoading(false);
        }, [api]);
        useEffect(() => {
          fetchErrors();
        }, [fetchErrors]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a dev-only guarded debug effect (lumina MainAIChatShell, delta audit)", () => {
    const result = runRule(
      noCascadingSetState,
      `function Shell({ t }) {
        const [input, setInput] = useState("");
        const [isExportSelectionMode, setIsExportSelectionMode] = useState(false);
        const [selectedExportIds, setSelectedExportIds] = useState([]);
        const [showHistory, setShowHistory] = useState(false);
        const handleNewChat = useCallback(() => {
          setIsExportSelectionMode(false);
          setSelectedExportIds([]);
          setShowHistory(false);
        }, []);
        useEffect(() => {
          if (!import.meta.env.DEV) {
            return;
          }
          handleNewChat();
          setInput(t.debugMessage);
        }, [handleNewChat, t]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not double-count a function declaration inside the effect body (open-design OnboardingDropdown, delta audit)", () => {
    const result = runRule(
      noCascadingSetState,
      `function OnboardingDropdown({ open, placement }) {
        const [resolvedPlacement, setResolvedPlacement] = useState(placement);
        const [menuMaxHeight, setMenuMaxHeight] = useState(240);
        useLayoutEffect(() => {
          if (!open) return;
          function measureMenu() {
            const nextPlacement = placement === "top" ? "top" : "bottom";
            setResolvedPlacement(nextPlacement);
            setMenuMaxHeight(200);
          }
          measureMenu();
          window.addEventListener("resize", measureMenu);
          return () => window.removeEventListener("resize", measureMenu);
        }, [open, placement]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not count a shared helper reached through branches or member chains (portos useStepStream, delta audit)", () => {
    const result = runRule(
      noCascadingSetState,
      `function useStepStream({ latest, closed, active }) {
        const [phase, setPhase] = useState("");
        const [op, setOp] = useState(null);
        const [isActive, setIsActive] = useState(false);
        const settle = useCallback(() => {
          setIsActive(false); setPhase(""); setOp(null);
          return null;
        }, []);
        useEffect(() => {
          if (!active) return;
          if (latest && latest.label) setPhase(latest.label);
          if (latest && latest.type === "complete") settle()?.onComplete?.(latest);
          else if (latest && latest.type === "error") settle()?.onError?.(new Error("failed"));
          else if (closed) settle()?.onError?.(new Error("lost connection"));
        }, [latest, closed, active, settle]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wholesale synchronous delegation to a component-level reset helper (portos Loras, delta recall gain)", () => {
    const result = runRule(
      noCascadingSetState,
      `function SuggestionsSection({ resetSignal }) {
        const [query, setQuery] = useState("");
        const [activeQuery, setActiveQuery] = useState("");
        const [liveCards, setLiveCards] = useState(null);
        const [cursor, setCursor] = useState(null);
        const resetToCached = useCallback(() => {
          setActiveQuery(""); setLiveCards(null); setCursor(null);
        }, []);
        useEffect(() => { setQuery(""); resetToCached(); }, [resetSignal, resetToCached]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an expression-bodied effect that delegates wholesale to a multi-setter reset helper (portos ManuscriptReadAloud, delta recall gain)", () => {
    const result = runRule(
      noCascadingSetState,
      `function ManuscriptReadAloud({ section, content }) {
        const [segments, setSegments] = useState(null);
        const [currentIndex, setCurrentIndex] = useState(-1);
        const [isPlaying, setIsPlaying] = useState(false);
        const [elapsedMs, setElapsedMs] = useState(0);
        const resetNarration = () => {
          setSegments(null);
          setCurrentIndex(-1);
          setIsPlaying(false);
          setElapsedMs(0);
        };
        useEffect(() => { resetNarration(); }, [section?.issueId, content]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("counts if/else branches as mutually exclusive — 2 setters per branch never co-run (max, not sum)", () => {
    const result = runRule(
      noCascadingSetState,
      `function Toggle({ mode }) {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        const [d, setD] = useState(0);
        useEffect(() => {
          if (mode === "on") {
            setA(1);
            setB(1);
          } else {
            setC(1);
            setD(1);
          }
        }, [mode]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when a single if/else branch holds 3 setters that do co-run", () => {
    const result = runRule(
      noCascadingSetState,
      `function Loader({ ready }) {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        useEffect(() => {
          if (ready) {
            setA(1);
            setB(2);
            setC(3);
          } else {
            setA(0);
          }
        }, [ready]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("treats a synchronous nested function declaration inside a switch case as its own scope", () => {
    const result = runRule(
      noCascadingSetState,
      `function Machine({ event }) {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        useEffect(() => {
          switch (event.type) {
            case "key": {
              function handleKeyDown() {
                setA(1);
                setB(2);
                setC(3);
              }
              window.addEventListener("keydown", handleKeyDown);
              break;
            }
            default:
              break;
          }
        }, [event]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not count a synchronous closure handed as an argument to a delegated helper", () => {
    const result = runRule(
      noCascadingSetState,
      `function Widget({ data }) {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        useEffect(() => {
          const applyLater = (callback) => {
            window.addEventListener("idle", callback);
          };
          applyLater(() => {
            setA(1);
            setB(2);
            setC(3);
          });
        }, [data]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still counts a functional updater's nested setters — they run on the same dispatch", () => {
    const result = runRule(
      noCascadingSetState,
      `function Chain({ input }) {
        const [a, setA] = useState(0);
        const [b, setB] = useState(0);
        const [c, setC] = useState(0);
        useEffect(() => {
          setA((prev) => {
            setB(prev + 1);
            setC(prev + 2);
            return prev;
          });
        }, [input]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still counts setters inside a synchronous forEach callback", () => {
    const result = runRule(
      noCascadingSetState,
      `function List({ items }) {
        const [first, setFirst] = useState(null);
        const [last, setLast] = useState(null);
        const [total, setTotal] = useState(0);
        useEffect(() => {
          items.forEach((innerItem) => {
            setFirst(innerItem.first);
            setLast(innerItem.last);
          });
          setTotal(items.length);
        }, [items]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
