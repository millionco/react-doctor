import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCascadingSetState } from "./no-cascading-set-state.js";

describe("no-cascading-set-state — regressions", () => {
  it("flags a stored listener handler beside a guarded setter (bench: cookiekit CookieConsentContext)", () => {
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

  it("flags an if/else setter ladder behind early-return guards (bench: openfootmanager MatchSimulation)", () => {
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
