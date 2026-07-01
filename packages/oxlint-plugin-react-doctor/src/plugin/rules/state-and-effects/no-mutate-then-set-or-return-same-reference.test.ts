import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutateThenSetOrReturnSameReference } from "./no-mutate-then-set-or-return-same-reference.js";

describe("no-mutate-then-set-or-return-same-reference", () => {
  it("flags setX(state.add(index)) on a state Set", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Synth = () => {
        const [sequence, setSequence] = useState(new Set([]));
        if (value) {
          setSequence(sequence.add(index));
        }
      };`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutate-prev-in-updater that returns the same reference", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Picker = () => {
        const [selected, setSelected] = useState(new Set());
        setSelected((prev) => {
          prev.delete(id);
          return prev;
        });
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutate-then-setX(X) on a state array", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Table = () => {
        const [rows, setRows] = useState(data);
        rows.sort(byName);
        setRows(rows);
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the concise self-returning mutator updater", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Picker = () => {
        const [selected, setSelected] = useState(new Set());
        setSelected((prev) => prev.add(id));
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags splice-then-return-prev in a functional updater", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Pack = () => {
        const [pack, setPack] = useState([]);
        setPack((oldPack) => {
          oldPack.splice(index, 1, newEmote);
          return oldPack;
        });
      };`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a fresh local via Array.from then mutated", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Survey = () => {
        const [questions, setQuestions] = useState([]);
        const newQuestions = Array.from(questions);
        newQuestions.splice(index, 1, updated);
        setQuestions(newQuestions);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a spread-copy then mutated", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Files = () => {
        const [files, setFiles] = useState([]);
        const next = [...files];
        next.splice(i, 1);
        setFiles(next);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a new Set(...) clone then mutated", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Synth = () => {
        const [sequence, setSequence] = useState(new Set());
        const clonedSet = new Set(sequence);
        clonedSet.delete(index);
        setSequence(clonedSet);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for react-router setSearchParams updater (not a useState setter)", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Plan = () => {
        const [searchParams, setSearchParams] = useSearchParams();
        setSearchParams((prev) => {
          prev.delete("plan");
          return prev;
        });
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for reverse on a freshly derived local with no setter", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const useGrouped = (messages) => {
        const groupAllMessages = groupBy(messages).reverse();
        return groupAllMessages;
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for concat which returns a new array", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const List = () => {
        const [items, setItems] = useState([]);
        setItems(items.concat(next));
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the mutation lives inside a nested handler", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Table = () => {
        const [rows, setRows] = useState(data);
        const onClick = () => {
          rows.sort(byName);
        };
        setRows(rows);
      };`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
