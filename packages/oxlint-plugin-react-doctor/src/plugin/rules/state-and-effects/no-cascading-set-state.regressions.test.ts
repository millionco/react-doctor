import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCascadingSetState } from "./no-cascading-set-state.js";

const runTsx = (code: string) => runRule(noCascadingSetState, code, { filename: "fixture.tsx" });

describe("state-and-effects/no-cascading-set-state — regressions: bench planted-bug shapes stay detected", () => {
  it("flags a synchronous setter plus a variable-stored handler registered via addEventListener in the same effect (cookiekit CookieConsentContext shape)", () => {
    const result = runTsx(`
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
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("3 setState calls");
  });

  it("flags sequential early-return guard blocks whose setters sum past the threshold (openfootmanager MatchSimulation shape)", () => {
    const result = runTsx(`
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
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a synchronous forEach cascade", () => {
    const result = runTsx(`
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
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags 3 synchronous setters in the effect body", () => {
    const result = runTsx(`
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
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("state-and-effects/no-cascading-set-state — regressions: FP-fix valid cases stay silent", () => {
  it("does not sum setters inside a deferred listener callback when the effect sets no state synchronously", () => {
    const result = runTsx(`
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
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not over-count: one synchronous setter plus a one-setter registered handler stays under the threshold", () => {
    const result = runTsx(`
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
    `);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count setters that only run in the effect cleanup", () => {
    const result = runTsx(`
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
    `);
    expect(result.diagnostics).toHaveLength(0);
  });
});
