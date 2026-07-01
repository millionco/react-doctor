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
      `
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an async IIFE that sets state after await", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Pricing = () => {
        const [imports, setLocalCatalogImport] = useState([]);
        useEffect(() => {
          (async () => {
            const res = await getCatalogImports();
            setLocalCatalogImport(res);
          })();
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useReducer dispatch called after await", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Widget = () => {
        const [state, dispatch] = useReducer(reducer, {});
        useEffect(() => {
          async function run() {
            const data = await load();
            dispatch({ type: "set", data });
          }
          run();
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the effect callback is itself async (owned by another rule)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [user, setUser] = useState(null);
        useEffect(async () => {
          const u = await load();
          setUser(u);
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the effect returns a cleanup function", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [user, setUser] = useState(null);
        useEffect(() => {
          let cancelled = false;
          const run = async () => {
            const u = await load();
            setUser(u);
          };
          run();
          return () => { cancelled = true; };
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the setter is gated behind a mounted flag", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [user, setUser] = useState(null);
        useEffect(() => {
          let isMounted = true;
          const run = async () => {
            const u = await load();
            if (isMounted) setUser(u);
          };
          run();
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setter that is not bound to useState/useReducer", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const Form = () => {
        const { setValue } = useForm();
        useEffect(() => {
          const run = async () => {
            const d = await load();
            setValue("x", d);
          };
          run();
        }, []);
      };
      `
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
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a setter inside a deeper nested closure that is not the awaiting scope", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [user, setUser] = useState(null);
        useEffect(() => {
          const run = async () => {
            await ready();
            subscribe(() => {
              setUser(current);
            });
          };
          run();
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the setter runs before the await", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [loading, setLoading] = useState(false);
        useEffect(() => {
          const run = async () => {
            setLoading(true);
            await load();
          };
          run();
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a void async IIFE whose setter after await sits in a try/catch (try/catch handles rejection, not unmount)", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const About = () => {
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
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when an AbortController signal/abort guard is present", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [data, setData] = useState(null);
        useEffect(() => {
          const controller = new AbortController();
          const run = async () => {
            const res = await fetch(url, { signal: controller.signal });
            setData(res);
          };
          run();
        }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain sync effect with no async work", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      const C = () => {
        const [title, setTitle] = useState("");
        useEffect(() => { setTitle(document.title); }, []);
      };
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
