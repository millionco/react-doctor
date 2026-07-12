import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEffectChain } from "./no-effect-chain.js";

describe("no-effect-chain — regressions", () => {
  it.each(["$", "($)", "void ($)", "(0, $)"])(
    "flags a cross-effect chain through discarded wrapper %s",
    (wrapper) => {
      const upstreamEffect = wrapper.replaceAll("$", "useEffect(() => { setFirst(1); }, [])");
      const downstreamEffect = wrapper.replaceAll(
        "$",
        "useEffect(() => { setSecond(first + 1); }, [first])",
      );
      const result = runRule(
        noEffectChain,
        `function C() {
          const [first, setFirst] = useState(0);
          const [second, setSecond] = useState(0);
          ${upstreamEffect};
          ${downstreamEffect};
          return second;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("still flags the canonical cross-effect state chain", () => {
    const result = runRule(
      noEffectChain,
      `function Game({ card }) {
        const [goldCardCount, setGoldCardCount] = useState(0);
        const [round, setRound] = useState(1);
        useEffect(() => { if (card.gold) setGoldCardCount(goldCardCount + 1); }, [card]);
        useEffect(() => { if (goldCardCount > 3) setRound(round + 1); }, [goldCardCount]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Docs-validation r2 docMismatch (Security.jsx): the downstream effect
  // only persists state to localStorage — synchronizing with an external
  // system, which the doc excludes; no re-render chain exists.
  it("stays silent when the downstream effect persists to localStorage", () => {
    const result = runRule(
      noEffectChain,
      `function Security() {
        const [selectedVideo, setSelectedVideo] = useState('');
        const [selectedAudio, setSelectedAudio] = useState('');
        useEffect(() => {
          const saved = JSON.parse(raw);
          if (saved.videoDeviceId) setSelectedVideo(saved.videoDeviceId);
          if (saved.audioDeviceId) setSelectedAudio(saved.audioDeviceId);
        }, []);
        useEffect(() => {
          if (selectedVideo || selectedAudio) {
            localStorage.setItem('media', JSON.stringify({ selectedVideo, selectedAudio }));
          }
        }, [selectedVideo, selectedAudio]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("treats window.sessionStorage access as external sync too", () => {
    const result = runRule(
      noEffectChain,
      `function C() {
        const [value, setValue] = useState('');
        useEffect(() => { setValue(compute()); }, []);
        useEffect(() => { window.sessionStorage.setItem('key', value); }, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation r2 (tracecat data-table): the downstream effect calls
  // the setter returned by useLocalStorage — the same browser-storage
  // persistence, one hook removed.
  it("stays silent when the downstream effect calls a useLocalStorage setter", () => {
    const result = runRule(
      noEffectChain,
      `function DataTable({ clearSelectionTrigger }) {
        const [tableState, setTableState] = useLocalStorage('table-state', {});
        const [rowSelection, setRowSelection] = useState({});
        const [sorting, setSorting] = useState([]);
        useEffect(() => { setRowSelection({}); }, [clearSelectionTrigger]);
        useEffect(() => {
          setTableState({ ...tableState, sorting, rowSelection });
        }, [sorting, rowSelection]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a chain whose downstream effect writes plain state", () => {
    const result = runRule(
      noEffectChain,
      `function C() {
        const [first, setFirst] = useState(0);
        const [second, setSecond] = useState(0);
        useEffect(() => { setFirst(1); }, []);
        useEffect(() => { setSecond(first + 1); }, [first]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
