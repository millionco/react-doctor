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
});
