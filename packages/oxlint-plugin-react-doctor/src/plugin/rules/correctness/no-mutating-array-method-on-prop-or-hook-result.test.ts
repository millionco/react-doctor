import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutatingArrayMethodOnPropOrHookResult } from "./no-mutating-array-method-on-prop-or-hook-result.js";

describe("no-mutating-array-method-on-prop-or-hook-result", () => {
  it("flags .sort() on a destructured-prop member (experiment-list shape)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function CustomExperimentListItem({ customExperiment }) {
        customExperiment.tags.sort();
        return null;
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .reverse() on a prop array (InsiderView shape)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function InsiderView({ memberships }) {
        memberships.reverse();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .splice() on a prop array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        items.splice(0, 1);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .sort() on a hook-call result", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const data = useQuery();
        data.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .sort() on a destructured hook result", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const { rows } = useTableData();
        rows.reverse();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag [...array].sort() copy-first", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const sorted = [...items].sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag array.slice().sort() copy-first", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const sorted = items.slice().sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag toSorted / toReversed immutable methods", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const a = items.toSorted();
        const b = items.toReversed();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a locally-constructed array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const local = [3, 1, 2];
        local.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain utility function's array parameter", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function sortInPlace(arr) {
        arr.sort();
        return arr;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an Immer produce draft parameter", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const next = produce(items, (draft) => {
          draft.sort();
        });
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useMutation callback parameter", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        useMutation((rows) => {
          rows.sort();
        });
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a binding whose name advertises mutability", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const mutableItems = items;
        mutableItems.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag splicing a ref's current array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const stackRef = useRef([]);
        stackRef.current.splice(index, 1);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reversing a keyed ref-current array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const mapRef = useRef({});
        mapRef.current[collection].splice(index, 1);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a sorted copy from spread bound to a variable", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        const copy = [...items];
        copy.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useCallback callback's own parameter (memoized-handler idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function Select({ onChange }) {
        const handleChange = useCallback((selectedValues) => {
          selectedValues.sort();
          onChange(selectedValues);
        }, [onChange]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a callback parameter inside a hook's options object (useMutation onSuccess idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const mutation = useMutation({ onSuccess: (rows) => rows.sort() });
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a prop rebound to a fresh filtered array first (react-big-calendar Agenda idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function Agenda({ events }) {
        events = events.filter((event) => inRange(event));
        events.sort((a, b) => +a.end - +b.end);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the rebind happens only after the mutating call", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function Agenda({ events }) {
        events.sort((a, b) => +a.end - +b.end);
        events = events.filter((event) => inRange(event));
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags self-assignment of the in-place sort result", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ items }) {
        items = items.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a setter-less useState container accessed by key (yet-another-react-lightbox events idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function useEvents() {
        const [subscriptions] = React.useState({});
        const unsubscribe = (topic, callback) => {
          subscriptions[topic].splice(subscriptions[topic].indexOf(callback), 1);
        };
        return unsubscribe;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a direct sort of a setter-less useState array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const [rows] = useState([]);
        rows.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a prop destructured in the function body", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List(props) {
        const { items } = props;
        items.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a prop-member alias bound in the function body", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List(props) {
        const list = props.items;
        list.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a prop whose name merely contains 'mutation' as a substring", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List({ permutations }) {
        permutations.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an alias of a ref's current array", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const stackRef = useRef([]);
        const stack = stackRef.current;
        stack.splice(0, 1);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
