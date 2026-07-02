import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCascadingSetState } from "./no-cascading-set-state.js";

describe("state-and-effects/no-cascading-set-state — regressions: mined bug shapes stay detected", () => {
  it("flags a synchronous setter plus a variable-stored handler registered via addEventListener in the same effect (cookiekit CookieConsentContext shape)", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("4 setState calls");
  });

  it("flags sequential early-return guard blocks whose setters sum past the threshold (openfootmanager MatchSimulation shape)", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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
  it("counts setters inside a variable-stored listener handler (stored handlers keep their call sites)", () => {
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
    expect(result.diagnostics).toHaveLength(1);
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
  it("flags a stored listener handler beside a guarded setter (cookiekit CookieConsentContext)", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an if/else setter ladder behind early-return guards (openfootmanager MatchSimulation)", () => {
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
    expect(result.diagnostics.length).toBeGreaterThan(0);
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
