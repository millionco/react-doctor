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
    expect(result.diagnostics).toHaveLength(0);
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("does not flag a direct splice of a setter-less useState registry (Timeouts provider idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function TimeoutsProvider({ children }) {
        const [timeouts] = React.useState([]);
        React.useEffect(
          () => () => {
            timeouts.forEach((tid) => window.clearTimeout(tid));
            timeouts.splice(0, timeouts.length);
          },
          [timeouts],
        );
        const context = React.useMemo(() => {
          const removeTimeout = (id) => {
            timeouts.splice(0, timeouts.length, ...timeouts.filter((tid) => tid !== id));
          };
          return { removeTimeout };
        }, [timeouts]);
        return children;
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

  it("still flags splice on a useState array whose setter IS destructured", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const [rows, setRows] = useState([]);
        rows.splice(0, 1);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags sort on a useState array passed back through its own setter (stories table idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function Table({ data }) {
        const [list, setList] = useState(data.slice());
        const sort = (descriptor) => {
          const result = list.sort((a, b) => (a[descriptor.column] < b[descriptor.column] ? -1 : 1));
          setList(result);
        };
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag sorting a useMemo result that is a fresh filtered copy (FileViewer idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function FileViewer() {
        const currentItemsFolder = useAppSelector((state) => state.storage.levels[state.id]);
        const folderFiles = useMemo(() => currentItemsFolder?.filter((item) => !item.isFolder), [currentItemsFolder]);
        const sortFolderFiles = useMemo(() => {
          if (folderFiles) {
            return folderFiles.sort((a, b) => (a.name > b.name ? 1 : -1));
          }
          return [];
        }, [folderFiles]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags sorting a useMemo result with a return path aliasing the source (recharts payload idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function Legend({ payload, allLineData }) {
        const allSeriesPayload = useMemo(() => {
          if (allLineData?.length) {
            return allLineData.map((ld) => ({ dataKey: ld.dataKey }));
          }
          return payload ?? [];
        }, [allLineData, payload]);
        const sortedLegendItems = useMemo(() => {
          return allSeriesPayload.sort((a, b) => a.dataKey.localeCompare(b.dataKey));
        }, [allSeriesPayload]);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags sorting a prop inside a useMemo factory (sidebar containerNames idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function Sidebar({ containerNames }) {
        const sortedContainerNames = useMemo(() => containerNames.sort(), [containerNames]);
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

  it("does not flag splicing a rest-element copy of a prop array (Breadcrumbs idiom)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function Breadcrumbs({ items }) {
        const [firstItem, ...restItems] = items;
        restItems.splice(0, restItems.length - 1);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag sorting a rest-element copy of a hook result", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const [firstRow, ...otherRows] = useRows();
        otherRows.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag splicing an object rest-element copy of a hook result", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List() {
        const { first, ...rest } = useEntries();
        rest.splice(0, 1);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a member array reached through an object rest binding", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function List(props) {
        const { onClick, ...rest } = props;
        rest.items.sort();
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a non-rest array-destructured element of a prop (nested array alias)", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `
      function Grid({ matrix }) {
        const [firstRow] = matrix;
        firstRow.sort();
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

  it("does not flag WAAPI Animation.reverse() held in state", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `function AccordionSection({ label, children }) {
        const contentRef = useRef(null);
        const [animation, setAnimation] = useState(null);
        useEffect(() => {
          const instance = contentRef.current.animate([{ height: "0px" }, { height: "auto" }], { duration: 180 });
          instance.pause();
          setAnimation(instance);
          return () => instance.cancel();
        }, []);
        const handleCollapse = () => { animation?.reverse(); };
        return <button onClick={handleCollapse}>{label}</button>;
      }`,
      { filename: "accordion.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a GSAP timeline prop with play/reverse controls", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `function TimelineControls({ timeline }) {
        return (
          <div>
            <button onClick={() => timeline.play()}>Play</button>
            <button onClick={() => timeline.reverse()}>Reverse</button>
          </div>
        );
      }`,
      { filename: "controls.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag splice on a MobX useLocalObservable store", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `const TodoList = observer(() => {
        const store = useLocalObservable(() => ({ todos: [] }));
        const removeTodo = (index) => { store.todos.splice(index, 1); };
        return <button onClick={() => removeTodo(0)}>remove</button>;
      });`,
      { filename: "todos.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag splice on a SyncedStore CRDT proxy", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `function TodoList() {
        const state = useSyncedStore(globalStore);
        const removeTodo = (index) => { state.todos.splice(index, 1); };
        return null;
      }`,
      { filename: "todos.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the subscribe/unsubscribe registry splice in effect cleanup", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `function useScrollLock(id) {
        const locks = useContext(ScrollLockContext);
        useEffect(() => {
          locks.push(id);
          return () => {
            locks.splice(locks.indexOf(id), 1);
          };
        }, [locks, id]);
      }`,
      { filename: "use-scroll-lock.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let an Immutable.js import exempt native prop arrays", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `import { List } from "immutable";
      function Tags({ items }) {
        const sorted = items.sort();
        return <div>{sorted.join(", ")}</div>;
      }`,
      { filename: "tags.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a sort-strategy object sorting rows passed as data", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `function DataTable({ rows, sortStrategy }) {
        const sortedRows = sortStrategy.sort(rows);
        return <ul>{sortedRows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>;
      }`,
      { filename: "table.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags splice inside effect cleanup with no paired registration", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `function useTrim(items) {
        const rows = useContext(RowsContext);
        useEffect(() => {
          return () => {
            rows.splice(0, 1);
          };
        }, [rows]);
      }`,
      { filename: "use-trim.ts" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a registry PARAM spliced in effect cleanup after a push", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `function useScrollLock(locks, id) {
        useEffect(() => {
          locks.push(id);
          return () => { locks.splice(locks.indexOf(id), 1); };
        }, [locks, id]);
      }`,
      { filename: "use-lock.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag splice on an ahooks useCreation stable container", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `function useQueue() {
        const queue = useCreation(() => [], []);
        const drop = (index) => { queue.splice(index, 1); };
        return drop;
      }`,
      { filename: "use-queue.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("audit regressions", () => {
  it("does not flag reverse and splice methods on an explicitly non-array prop", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `const Controls = ({ controller }: { controller: { reverse(): void; splice(position: number): void } }) => {
        controller.reverse();
        controller.splice(0);
        return null;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a same-file interface that declares a controller reverse method", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `interface Controller { reverse(): void }
       interface Props { value: Controller }
       const Controls = ({ value }: Props) => { value.reverse(); return null; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an array interface that redeclares reverse", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `interface Rows extends Array<string> { reverse(): Rows }
       const List = ({ rows }: { rows: Rows }) => { rows.reverse(); return null; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a conditional fresh-array rebind", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `const C = ({ items, copy }) => { if (copy) items = items.slice(); return items.sort(); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not disable native-array checks for an Immutable import", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `import { List } from "immutable"; const C = ({ items }: { items: string[] }) => items.sort();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("abstains on an unknown custom hook collection API", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `const C = () => { const ranking = useRanking(); return ranking.sort(); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let a merged controller declaration hide an array base", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `interface Rows { reverse(): Rows }
       interface Rows extends Array<string> {}
       const C = ({ rows }: { rows: Rows }) => rows.reverse();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a static computed mutating method on a prop", () => {
    const result = runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      `const C = ({ items }) => items["sort"]().map(String);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
