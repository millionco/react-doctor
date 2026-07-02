import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";

describe("no-chain-state-updates — regressions", () => {
  it("fires on mixed-origin state (handler setter plus one setTimeout site — bench: basis form)", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const Search = () => {
        const [query, setQuery] = useState("");
        const [highlighted, setHighlighted] = useState(-1);
        const clearLater = () => {
          setTimeout(() => setQuery(""), 5000);
        };
        const onChange = (event) => setQuery(event.target.value);
        useEffect(() => {
          setHighlighted(-1);
        }, [query]);
        return <input onChange={onChange} onBlur={clearLater} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires when the setter is also wired through an onX config-object property (bench: wangeditor)", () => {
    const result = runRule(
      noChainStateUpdates,
      `function Editor({ defaultContent }) {
        const [editor, setEditor] = useState(null);
        const handleDestroyed = useCallback(() => {
          setEditor(null);
        }, []);
        useEffect(() => {
          if (editor != null) return;
          const newEditor = createEditor({ onDestroyed: handleDestroyed });
          setEditor(newEditor);
        }, [editor]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires when the state is also set from an async event handler (bench: react-sounds)", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const Form = () => {
        const [saved, setSaved] = useState(false);
        const [toast, setToast] = useState("");
        const handleSubmit = async () => {
          await api.save();
          setSaved(true);
        };
        useEffect(() => {
          if (saved) setToast("Saved!");
        }, [saved]);
        return <button onClick={handleSubmit}>save</button>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("fires when the chained setter runs through an async useCallback handler", () => {
    const result = runRule(
      noChainStateUpdates,
      `function useSound(src) {
        const [isPlaying, setIsPlaying] = useState(false);
        const [status, setStatus] = useState("idle");
        const play = useCallback(async () => {
          await loadSound(src);
          setIsPlaying(true);
        }, [src]);
        const stop = useCallback(() => {
          setIsPlaying(false);
        }, []);
        useEffect(() => {
          setStatus("changed");
        }, [isPlaying]);
        return { play, stop };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when every triggering state dep is exclusively interval-driven", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const Clock = () => {
        const [now, setNow] = useState(Date.now());
        const [late, setLate] = useState(false);
        useEffect(() => {
          const id = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(id);
        }, []);
        useEffect(() => {
          if (now % 2 === 0) setLate(true);
        }, [now]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the triggering state is set only inside a .then continuation", () => {
    const result = runRule(
      noChainStateUpdates,
      `export const List = ({ url }) => {
        const [data, setData] = useState(null);
        const [page, setPage] = useState(1);
        useEffect(() => {
          fetch(url).then((response) => response.json()).then((json) => setData(json));
        }, [url]);
        useEffect(() => {
          setPage(1);
        }, [data]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
