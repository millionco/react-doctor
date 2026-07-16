import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

describe("no-set-state-after-await-in-effect", () => {
  it("flags a declared-then-called inner async function that sets state after await", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Note = ({ id }) => {
        const [note, setNote] = useState(null);
        useEffect(() => {
          const fetchData = async () => {
            const data = await load(id);
            setNote(data);
          };
          fetchData();
        }, [id]);
        return null;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an async IIFE that sets state after await when deps can change", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Pricing = ({ catalogId }) => {
        const [imports, setLocalCatalogImport] = useState([]);
        useEffect(() => {
          (async () => {
            const res = await getCatalogImports(catalogId);
            setLocalCatalogImport(res);
          })();
        }, [catalogId]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useReducer dispatch called after await when deps can change", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Widget = ({ query }) => {
        const [state, dispatch] = useReducer(reducer, {});
        useEffect(() => {
          async function run() {
            const data = await load(query);
            dispatch({ type: "set", data });
          }
          run();
        }, [query]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unguarded post-await setter when the deps argument is omitted", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [user, setUser] = useState(null);
        useEffect(() => {
          (async () => {
            const u = await load();
            setUser(u);
          })();
        });
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a setter whose argument contains the await, like setUser(await load())", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ id }) => {
        const [user, setUser] = useState(null);
        useEffect(() => {
          (async () => {
            setUser(await load(id));
          })();
        }, [id]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags streaming setters inside a for await...of loop when deps can change", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ topic }) => {
        const [chunks, setChunks] = useState([]);
        useEffect(() => {
          (async () => {
            for await (const chunk of stream(topic)) {
              setChunks((prev) => prev.concat(chunk));
            }
          })();
        }, [topic]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a mount-only effect (empty deps) — the one-shot fetch idiom from TaskTrove/dtale cannot re-run out of order", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const AboutModal = () => {
        const [version, setVersion] = useState("");
        useEffect(() => {
          (async () => {
            const res = await getVersionInfo();
            setVersion(res.version);
          })();
        }, []);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when every dependency is a stable-identity binding (setter/ref) — deps that never change identity cannot cause overlapping re-runs", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [user, setUser] = useState(null);
        const storeRef = useRef(null);
        useEffect(() => {
          const run = async () => {
            const u = await load();
            setUser(u);
          };
          run();
        }, [setUser, storeRef]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the effect callback is itself async (owned by another rule)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ id }) => {
        const [user, setUser] = useState(null);
        useEffect(async () => {
          const u = await load(id);
          setUser(u);
        }, [id]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the effect returns a cleanup function", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ userId }) => {
        const [user, setUser] = useState(null);
        useEffect(() => {
          let cancelled = false;
          const run = async () => {
            const u = await load(userId);
            setUser(u);
          };
          run();
          return () => { cancelled = true; };
        }, [userId]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the setter is gated behind a mounted flag", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ userId }) => {
        const [user, setUser] = useState(null);
        useEffect(() => {
          let isMounted = true;
          const run = async () => {
            const u = await load(userId);
            if (isMounted) setUser(u);
          };
          run();
        }, [userId]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setter that is not bound to useState/useReducer", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Form = ({ fieldId }) => {
        const { setValue } = useForm();
        useEffect(() => {
          const run = async () => {
            const d = await load(fieldId);
            setValue("x", d);
          };
          run();
        }, [fieldId]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setState after await inside an event handler", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [user, setUser] = useState(null);
        const onClick = async () => {
          const u = await load();
          setUser(u);
        };
        return <button onClick={onClick} />;
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setter inside a deeper nested closure that is not the awaiting scope", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ topic }) => {
        const [user, setUser] = useState(null);
        useEffect(() => {
          const run = async () => {
            await ready(topic);
            subscribe(() => {
              setUser(current);
            });
          };
          run();
        }, [topic]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the setter runs before the await", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ id }) => {
        const [loading, setLoading] = useState(false);
        useEffect(() => {
          const run = async () => {
            setLoading(true);
            await load(id);
          };
          run();
        }, [id]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a void async IIFE whose setter after await sits in a try/catch (try/catch handles rejection, not stale re-runs)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const About = ({ url }) => {
        const [version, setVersion] = useState("");
        useEffect(() => {
          void (async () => {
            try {
              const res = await getDataFromService(url);
              setVersion(res.version);
            } catch (e) {
              setVersion("");
            }
          })();
        }, [url]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when an AbortController signal/abort guard is present", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ url }) => {
        const [data, setData] = useState(null);
        useEffect(() => {
          const controller = new AbortController();
          const run = async () => {
            const res = await fetch(url, { signal: controller.signal });
            setData(res);
          };
          run();
        }, [url]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the only dep is an external-store action the effect just invokes (zustand useStore + useShallow destructure)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const NotificationsView = () => {
        const { fetchNotifications } = useStore(
          useShallow((s) => ({ fetchNotifications: s.fetchNotifications })),
        );
        const [isBusy, setIsBusy] = useState(true);
        useEffect(() => {
          const loadNotifications = async () => {
            setIsBusy(true);
            try {
              await fetchNotifications();
            } finally {
              setIsBusy(false);
            }
          };
          void loadNotifications();
        }, [fetchNotifications]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the dep is a store action selected directly (useUserStore((s) => s.fetchUser))", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Profile = () => {
        const fetchUser = useUserStore((s) => s.fetchUser);
        const [profile, setProfile] = useState(null);
        useEffect(() => {
          const run = async () => {
            const loaded = await fetchUser();
            setProfile(loaded);
          };
          run();
        }, [fetchUser]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when every dep is a module-scope const — its identity can never change between renders", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const DATA_SOURCE = "SOCRATA";
      const Footer = () => {
        const [lastUpdated, setLastUpdated] = useState("");
        useEffect(() => {
          const run = async () => {
            const rows = await queryLastUpdated(DATA_SOURCE);
            setLastUpdated(rows[0]);
          };
          run();
        }, [DATA_SOURCE]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags when a store-selected dep is read as data, not invoked — selected state can change identity per render", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Detail = () => {
        const selectedId = useAppStore((s) => s.selectedId);
        const [detail, setDetail] = useState(null);
        useEffect(() => {
          const run = async () => {
            const loaded = await load(selectedId);
            setDetail(loaded);
          };
          run();
        }, [selectedId]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags try/catch status-literal writes after await when deps can change — which branch lands depends on which run resolves last (VerifyEmailPage shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const VerifyEmailPage = () => {
        const { t } = useTranslation("auth");
        const searchParams = useSearch({ strict: false });
        const token = searchParams.token;
        const [status, setStatus] = useState("pending");
        useEffect(() => {
          const verify = async () => {
            try {
              await apiClient.post("/auth/verification/confirm", { token });
              setStatus("success");
            } catch (err) {
              setStatus("error");
            }
          };
          void verify();
        }, [token, t]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an awaited-derived setter when a mutable context dep rides alongside a module-scope const (LastUpdated shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const DATA_SOURCE = "DUCKDB";
      const LastUpdated = () => {
        const [lastUpdated, setLastUpdated] = useState("");
        const { conn } = useContext(DbContext);
        useEffect(() => {
          const getLastUpdated = async () => {
            const rows = await conn.query("select max(createddate) from requests;");
            setLastUpdated(rows[0]);
          };
          if (DATA_SOURCE !== "SOCRATA" && conn) {
            getLastUpdated();
          }
        }, [conn, DATA_SOURCE]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an awaited-derived setter when a context-provided callback dep can change identity (MentionPanel shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const MentionPanel = () => {
        const { loadViews } = useEditorContext();
        const [open] = useState(false);
        const [views, setViews] = useState([]);
        useEffect(() => {
          if (!open || !loadViews) return;
          void (async () => {
            try {
              const result = await loadViews();
              setViews(result);
            } catch (e) {
              console.error(e);
            }
          })();
        }, [loadViews, open]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a plain sync effect with no async work", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = ({ id }) => {
        const [title, setTitle] = useState("");
        useEffect(() => { setTitle(document.title); }, [id]);
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a module-level in-flight mutex set before the await (medusa shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `let IS_REQUEST_RUNNING = false;
       const ClaimCreate = ({ preview, createClaim }) => {
         const [activeClaimId, setActiveClaimId] = useState(null);
         useEffect(() => {
           async function run() {
             if (IS_REQUEST_RUNNING || !preview) return;
             IS_REQUEST_RUNNING = true;
             try {
               const claim = await createClaim({ order_id: preview.id });
               setActiveClaimId(claim.id);
             } finally {
               IS_REQUEST_RUNNING = false;
             }
           }
           run();
         }, [preview, createClaim]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a useState in-flight latch toggled around the await (outline shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const DefaultCollectionSelect = ({ collections }) => {
         const [fetching, setFetching] = useState(false);
         const [fetchError, setFetchError] = useState(null);
         useEffect(() => {
           async function load() {
             if (fetching || fetchError) return;
             setFetching(true);
             try {
               await collections.fetchAll();
             } catch (error) {
               setFetchError(error);
             } finally {
               setFetching(false);
             }
           }
           load();
         }, [fetching, fetchError, collections]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a run-once ref guard sits in the effect callback prologue (memos shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const AuthCallback = ({ searchParams }) => {
         const handledRef = useRef(false);
         const [message, setMessage] = useState("");
         useEffect(() => {
           if (handledRef.current) return;
           handledRef.current = true;
           (async () => {
             const result = await exchangeToken(searchParams);
             setMessage(result.status);
           })();
         }, [searchParams]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a merge-shaped functional updater keyed by a closed-over dep (mastodon shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const LocaleLoader = ({ currentLocale }) => {
         const [messages, setMessages] = useState({});
         useEffect(() => {
           async function loadLocale() {
             const localeFile = await import(\`./locales/\${currentLocale}.json\`);
             setMessages((prev) => ({ ...prev, [currentLocale]: localeFile }));
           }
           loadLocale();
         }, [currentLocale]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when deps are only stable-result hooks like useNavigate (NextChat shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const McpMarket = () => {
         const navigate = useNavigate();
         const [enabled, setEnabled] = useState(false);
         useEffect(() => {
           const checkMcp = async () => {
             const config = await getServerConfig();
             if (!config.enableMcp) {
               navigate("/home");
               return;
             }
             setEnabled(true);
           };
           checkMcp();
         }, [navigate]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a replace-shaped functional updater after await", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const Profile = ({ userId }) => {
         const [profile, setProfile] = useState(null);
         useEffect(() => {
           async function load() {
             const fetched = await fetchProfile(userId);
             setProfile(() => fetched);
           }
           load();
         }, [userId]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a pre-await early return that is narrowing, not a latch", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const Note = ({ note }) => {
         const [body, setBody] = useState(null);
         useEffect(() => {
           async function load() {
             if (!note) return;
             const data = await fetchBody(note.id);
             setBody(data);
           }
           load();
         }, [note]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: useCallback with empty deps as the only dependency (de-facto mount-only)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const Dashboard = () => {
  const loadStats = useCallback(async () => statsApi.fetchSummary(), []);
  const [stats, setStats] = useState(null);
  useEffect(() => {
    const run = async () => {
      const summary = await loadStats();
      setStats(summary);
    };
    run();
  }, [loadStats]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: useAppDispatch (Redux Toolkit's documented typed dispatch wrapper) as the only dependency", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const SessionBootstrap = () => {
  const dispatch = useAppDispatch();
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const bootstrap = async () => {
      const session = await loadPersistedSession();
      dispatch(sessionRestored(session));
      setRestored(true);
    };
    bootstrap();
  }, [dispatch]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: next/navigation useRouter as the only dependency (stable app-router instance)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `import { useRouter } from "next/navigation";
const AuthGate = ({ children }) => {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const verify = async () => {
      const session = await getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setChecked(true);
    };
    verify();
  }, [router]);
  return checked ? children : null;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Block-bodied object-merge updater with a temp variable (same semantics as the exempt inline spread)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const LocaleLoader = ({ currentLocale }) => {
  const [messages, setMessages] = useState({});
  useEffect(() => {
    const loadLocale = async () => {
      const localeFile = await import("./locales/" + currentLocale + ".json");
      setMessages((prev) => {
        const next = { ...prev, [currentLocale]: localeFile };
        return next;
      });
    };
    loadLocale();
  }, [currentLocale]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Map-merge functional updater keyed by the dep (order-independent cache)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const LocaleLoader = ({ locale }) => {
  const [bundles, setBundles] = useState(new Map());
  useEffect(() => {
    const load = async () => {
      const bundle = await fetchLocaleBundle(locale);
      setBundles((prev) => new Map(prev).set(locale, bundle));
    };
    load();
  }, [locale]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Object.assign-shaped merge updater", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const ThumbnailGrid = ({ assetId }) => {
  const [thumbnails, setThumbnails] = useState({});
  useEffect(() => {
    const resolve = async () => {
      const thumbnailUrl = await resolveThumbnail(assetId);
      setThumbnails((prev) => Object.assign({}, prev, { [assetId]: thumbnailUrl }));
    };
    resolve();
  }, [assetId]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Guarded merge updater that no-ops when the key already exists", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const PageCache = ({ pageId }) => {
  const [pages, setPages] = useState({});
  useEffect(() => {
    const load = async () => {
      const rows = await fetchPage(pageId);
      setPages((prev) => {
        if (prev[pageId]) return prev;
        return { ...prev, [pageId]: rows };
      });
    };
    load();
  }, [pageId]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Set-union functional updater keyed by the dep", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const ImagePreloader = ({ src }) => {
  const [loadedSrcs, setLoadedSrcs] = useState(() => new Set());
  useEffect(() => {
    const preload = async () => {
      await preloadImage(src);
      setLoadedSrcs((prev) => new Set(prev).add(src));
    };
    preload();
  }, [src]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Module-level sequence counter implementing latest-request-wins (the rule's own remediation)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `let searchSeq = 0;
const Search = ({ query }) => {
  const [results, setResults] = useState([]);
  useEffect(() => {
    const seq = ++searchSeq;
    const run = async () => {
      const found = await searchApi(query);
      if (seq !== searchSeq) return;
      setResults(found);
    };
    run();
  }, [query]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: String-status one-shot latch (same concurrency semantics as the blessed boolean latch)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const MigrationGate = () => {
  const [phase, setPhase] = useState("pending");
  useEffect(() => {
    const advance = async () => {
      if (phase !== "pending") return;
      setPhase("running");
      await runPendingMigrations();
      setPhase("ready");
    };
    advance();
  }, [phase]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: react-hook-form reset as the only dependency (documented stable method)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const ProfileForm = () => {
  const { reset } = useForm();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const hydrate = async () => {
      const profile = await api.fetchProfile();
      reset(profile);
      setHydrated(true);
    };
    hydrate();
  }, [reset]);
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a useCallback dep whose own deps are non-empty", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const Dashboard = ({ range }) => {
         const loadStats = useCallback(async () => statsApi.fetchSummary(range), [range]);
         const [stats, setStats] = useState(null);
         useEffect(() => {
           const run = async () => {
             const summary = await loadStats();
             setStats(summary);
           };
           run();
         }, [loadStats]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a block-bodied updater whose return replaces prev", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const Profile = ({ userId }) => {
         const [profile, setProfile] = useState(null);
         useEffect(() => {
           const load = async () => {
             const fetched = await fetchProfile(userId);
             setProfile((prev) => {
               const next = { name: fetched.name };
               return next;
             });
           };
           load();
         }, [userId]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a sequence guard comparing unrelated names", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `let searchSeq = 0;
       const Search = ({ query }) => {
         const [results, setResults] = useState([]);
         useEffect(() => {
           const seq = ++searchSeq;
           const run = async () => {
             const found = await searchApi(query);
             if (seq !== query.length) return;
             setResults(found);
           };
           run();
         }, [query]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on a wrap-in-if useState latch with try/finally reset (outline shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const DefaultCollectionSelect = observer(({ collections }) => {
         const [fetching, setFetching] = useState(false);
         const [fetchError, setFetchError] = useState();
         React.useEffect(() => {
           async function fetchData() {
             if (!collections.isLoaded && !fetching && !fetchError) {
               try {
                 setFetching(true);
                 await collections.fetchPage({ limit: 100 });
               } catch (error) {
                 setFetchError(error);
               } finally {
                 setFetching(false);
               }
             }
           }
           void fetchData();
         }, [fetchError, fetching, collections]);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the awaited work is independent of every per-render value (dep only gates the fetch)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `import referralService from './referral.service';
       const NavbarGlobalSearch = () => {
         const isReferralEligible = useAppSelector((state) => state.referrals.isEligible);
         const [customLauncherLabel, setCustomLauncherLabel] = useState('');
         useEffect(() => {
           const fetchLabel = async () => {
             const label = await referralService.getCustomLauncherLabel();
             if (label) {
               setCustomLauncherLabel(label);
             }
           };
           if (isReferralEligible) {
             fetchLabel();
           }
         }, [isReferralEligible]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the awaited work reads the changing dep (result varies across runs)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const MentionPerson = ({ personId }) => {
         const [name, setName] = useState('');
         useEffect(() => {
           const load = async () => {
             const person = await fetchPerson(personId);
             setName(person.name);
           };
           load();
         }, [personId]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the only dep is a context-hook service used purely as a method-call receiver", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const VerificationWebViewScreen = () => {
         const { identityService } = useQueryContext();
         const [authHeaders, setAuthHeaders] = useState(null);
         useEffect(() => {
           const fetchAuthHeaders = async () => {
             try {
               const headers = await identityService.getAuthHeaders();
               setAuthHeaders(headers);
             } catch (error) {
               console.error('Failed to fetch auth headers:', error);
             }
           };
           fetchAuthHeaders();
         }, [identityService]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a context-hook dep that is invoked directly (recreated callback identity)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const RelatedViews = () => {
         const { fetchViews } = useViewLoaderContext();
         const [folder, setFolder] = useState(null);
         useEffect(() => {
           const load = async () => {
             const data = await fetchViews();
             setFolder(data);
           };
           load();
         }, [fetchViews]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a context-hook service dep when an unstable dep rides alongside it", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const FileBlock = ({ retryLocalUrl }) => {
         const { fileHandler } = useEditorContext();
         const [localUrl, setLocalUrl] = useState(null);
         useEffect(() => {
           const load = async () => {
             const file = await fileHandler.getStoredFile(retryLocalUrl);
             setLocalUrl(file);
           };
           load();
         }, [fileHandler, retryLocalUrl]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on a module-let mutex checked and set in the effect callback around the async work (commercelayer shape)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `let loadingResource = false;
       const PaymentMethod = ({ paymentMethods, autoSelectSinglePaymentMethod }) => {
         const [paymentSelected, setPaymentSelected] = useState('');
         useEffect(() => {
           if (paymentMethods != null && !loadingResource) {
             loadingResource = true;
             if (autoSelectSinglePaymentMethod != null) {
               const autoSelect = async () => {
                 const ps = await createPaymentSource(paymentMethods[0]);
                 if (ps) {
                   setPaymentSelected(ps.id);
                 }
               };
               autoSelect();
             }
           }
         }, [paymentMethods, autoSelectSinglePaymentMethod]);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
