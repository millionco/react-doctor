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
      };`,
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
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutate-then-setX(X) on a state array", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Table = () => {
        const [rows, setRows] = useState([]);
        rows.sort(byName);
        setRows(rows);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the concise self-returning mutator updater", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Picker = () => {
        const [selected, setSelected] = useState(new Set());
        setSelected((prev) => prev.add(id));
      };`,
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
      };`,
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
      };`,
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
      };`,
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
      };`,
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
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for reverse on a freshly derived local with no setter", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const useGrouped = (messages) => {
        const groupAllMessages = groupBy(messages).reverse();
        return groupAllMessages;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for concat which returns a new array", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const List = () => {
        const [items, setItems] = useState([]);
        setItems(items.concat(next));
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a member-chain in-place mutation then setX(X) (form.tags.push then setForm(form))", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Form = () => {
        const [form, setForm] = useState({ tags: [] });
        const addTag = (tag) => {
          form.tags.push(tag);
          setForm(form);
        };
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for the fetch-then-sort-then-set idiom where a callback param shadows the state name", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Feed = () => {
        const [posts, setPosts] = useState([]);
        useEffect(() => {
          fetchPosts().then((posts) => {
            posts.sort(byDate);
            setPosts(posts);
          });
        }, []);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a fresh await-ed local that shadows the state name (internxt const teams = await fetch)", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Members = () => {
        const [teams, setTeams] = useState([]);
        const refresh = async () => {
          const teams = await fetchTeams();
          teams.sort(byName);
          setTeams(teams);
        };
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a fresh empty local built up inside an effect that shadows the state name (AppFlowy const views = [])", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Sidebar = () => {
        const [views, setViews] = useState([]);
        useEffect(() => {
          const views = [];
          views.push(rootView);
          setViews(views);
        }, []);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a JSX callback param shadows the state value handed to the setter (rsuite onShowColor)", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Palette = () => {
        const [color, setColor] = useState(new Map());
        return <Picker onShowColor={(color) => setColor(color.set("hue", 1))} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for dayjs date math where .add returns a new instance (antd/mantine date pickers)", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Calendar = () => {
        const [date, setDate] = useState(dayjs());
        const nextDay = () => setDate(date.add(1, "day"));
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for Immutable.js .set which returns a new map", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Editor = () => {
        const [doc, setDoc] = useState(ImmutableMap());
        const rename = (name) => setDoc(doc.set("name", name));
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a concise dayjs updater where .add returns a new instance", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Calendar = () => {
        const [date, setDate] = useState(dayjs());
        const nextDay = () => setDate((prev) => prev.add(1, "day"));
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags setX(state.add(x)) when a lazy initializer proves a native Set", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Synth = () => {
        const [sequence, setSequence] = useState(() => new Set());
        setSequence(sequence.add(index));
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the mutation lives inside a nested handler", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Table = () => {
        const [rows, setRows] = useState([]);
        const onClick = () => {
          rows.sort(byName);
        };
        setRows(rows);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: dayjs clamp updater: .add returns a new instance, `return prev` is the documented bailout", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Calendar = () => {
  const [date, setDate] = useState(dayjs());
  const goToNextDay = () => {
    setDate((prev) => {
      const next = prev.add(1, "day");
      if (next.isAfter(maxDate)) return prev;
      return next;
    });
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Luxon DateTime.set updater with a min-time clamp", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const TimeField = () => {
  const [selected, setSelected] = useState(DateTime.now());
  const commitTime = (hour, minute) => {
    setSelected((prev) => {
      const next = prev.set({ hour, minute });
      if (next < minTime) return prev;
      return next;
    });
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Immutable.js Map .delete after a .has bailout", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Filters = () => {
  const [filters, setFilters] = useState(ImmutableMap());
  const removeFilter = (key) => {
    setFilters((prev) => {
      if (!prev.has(key)) return prev;
      return prev.delete(key);
    });
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Immutable.js List .push with a size-cap bailout", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const HistoryPanel = () => {
  const [history, setHistory] = useState(ImmutableList());
  const record = (entry) => {
    setHistory((prev) => {
      if (prev.size >= MAX_HISTORY_ENTRIES) return prev;
      return prev.push(entry);
    });
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Temporal.PlainDate .add clamp — immutable by ECMAScript spec", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const DueDatePicker = () => {
  const [dueDate, setDueDate] = useState(() => Temporal.Now.plainDateISO());
  const postponeOneDay = () => {
    setDueDate((prev) => {
      const next = prev.add({ days: 1 });
      if (Temporal.PlainDate.compare(next, maxDue) > 0) return prev;
      return next;
    });
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Cross-pair range clamp: setEnd(start) while start.add() (dayjs, immutable) is in the same handler", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const DateRangePicker = () => {
  const [start, setStart] = useState(dayjs());
  const [end, setEnd] = useState(dayjs().add(1, "day"));
  const onEndChange = (candidate) => {
    const minEnd = start.add(1, "hour");
    if (candidate.isBefore(minEnd)) {
      setEnd(start);
      return;
    }
    setEnd(candidate);
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Updater reassigns the param to a fresh copy before mutating", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const UploadQueue = () => {
  const [queue, setQueue] = useState([]);
  const enqueue = (job) => {
    setQueue((prev) => {
      prev = prev.slice();
      prev.push(job);
      return prev;
    });
  };
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a discard-position push then return prev", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Queue = () => {
         const [jobs, setJobs] = useState([]);
         const enqueue = (job) => {
           setJobs((prev) => {
             prev.push(job);
             return prev;
           });
         };
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a bound mutator result on a proven Set state", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const Tags = () => {
         const [tags, setTags] = useState(new Set());
         const addTag = (tag) => {
           setTags((prev) => {
             const next = prev.add(tag);
             if (next.size > MAX_TAGS) return prev;
             return next;
           });
         };
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires an exact React useState pair", () => {
    const localHook = runRule(
      noMutateThenSetOrReturnSameReference,
      "const useState = (value) => [value, (next) => next]; const [rows, setRows] = useState([]); rows.sort(); setRows(rows);",
    );
    const reducer = runRule(
      noMutateThenSetOrReturnSameReference,
      "const [rows, dispatch] = useReducer(reducer, []); rows.sort(); dispatch(rows);",
    );
    const crossPair = runRule(
      noMutateThenSetOrReturnSameReference,
      "const [rows] = useState([]); const [, setOther] = useState([]); setOther(rows.sort());",
    );
    expect(localHook.diagnostics).toHaveLength(0);
    expect(reducer.diagnostics).toHaveLength(0);
    expect(crossPair.diagnostics).toHaveLength(0);
  });

  it("requires mutation before the setter on a reachable path", () => {
    const afterSetter = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C = () => { const [rows, setRows] = useState([]); setRows(rows); rows.sort(); };",
    );
    const exclusiveBranch = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C = ({ flag }) => { const [rows, setRows] = useState([]); if (flag) rows.sort(); else setRows(rows); };",
    );
    expect(afterSetter.diagnostics).toHaveLength(0);
    expect(exclusiveBranch.diagnostics).toHaveLength(0);
  });

  it("keeps the stale path when a copy assignment is conditional", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C = ({ flag }) => { const [, setRows] = useState([]); setRows((previous) => { if (flag) previous = previous.slice(); previous.push(1); return previous; }); };",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts try-block copies when catch paths cannot continue stale", () => {
    const catchReturns = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setRows]=useState([]);setRows(rows=>{try{rows=[...rows]}catch{return []}rows.push(1);return rows})}",
    );
    const catchCopies = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setRows]=useState([]);setRows(rows=>{try{rows=[...rows]}catch{rows=[]}rows.push(1);return rows})}",
    );
    const nonThrowingCopy = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setRows]=useState([]);setRows(rows=>{try{rows=[]}catch{}rows.push(1);return rows})}",
    );
    expect(catchReturns.diagnostics).toHaveLength(0);
    expect(catchCopies.diagnostics).toHaveLength(0);
    expect(nonThrowingCopy.diagnostics).toHaveLength(0);
  });

  it("rejects try-block copies when a catch path can continue stale", () => {
    const spreadCanThrow = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setRows]=useState([]);setRows(rows=>{try{rows=[...rows]}catch{}rows.push(1);return rows})}",
    );
    const methodCanThrow = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setRows]=useState([]);setRows(rows=>{try{rows=rows.slice()}catch{}rows.push(1);return rows})}",
    );
    const conditionalCatchCopy = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({recover})=>{const[,setRows]=useState([]);setRows(rows=>{try{rows=[...rows]}catch{if(recover)rows=[]}rows.push(1);return rows})}",
    );
    expect(spreadCanThrow.diagnostics).toHaveLength(1);
    expect(methodCanThrow.diagnostics).toHaveLength(1);
    expect(conditionalCatchCopy.diagnostics).toHaveLength(1);
  });

  it("does not infer mutation methods on opaque immutable state", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      'const C = () => { const [, setDate] = useState(dayjs()); setDate((previous) => { previous.add(1, "day"); return previous; }); };',
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine mutations and same-reference results from correlated exclusive paths", () => {
    const updater = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({flag})=>{const[,setRows]=useState([]);setRows(previous=>{if(flag)previous.push(1);return flag?[...previous]:previous})}",
    );
    const direct = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({flag})=>{const[rows,setRows]=useState([]);if(flag)rows.push(1);if(flag)return null;setRows(rows)}",
    );
    expect(updater.diagnostics).toHaveLength(0);
    expect(direct.diagnostics).toHaveLength(0);
  });

  it("uses explicit useState array types when the initializer comes from props", () => {
    const direct = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({initialRows}:{initialRows:Row[]})=>{const[rows,setRows]=useState<Row[]>(initialRows);rows.push(nextRow);setRows(rows)}",
    );
    const updater = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({initialRows}:{initialRows:Row[]})=>{const[,setRows]=useState<Row[]>(initialRows);setRows(previous=>{previous.push(nextRow);return previous})}",
    );
    expect(direct.diagnostics).toHaveLength(1);
    expect(updater.diagnostics).toHaveLength(1);
  });

  it("handles contradictory predicates, boolean equality, and restored original references", () => {
    const contradiction = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({flag})=>{const[,setItems]=useState<number[]>([]);setItems(items=>{if(flag){if(!flag)items.push(1)}if(flag)return items;return [...items]})}",
    );
    const equalityBranches = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({flag})=>{const[items,setItems]=useState<number[]>([]);if(flag===true)items.push(1);if(flag===false)setItems(items)}",
    );
    const restoredOriginal = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setItems]=useState<number[]>([]);setItems(items=>{const original=items;items=[...items];items=original;items.push(1);return items})}",
    );
    expect(contradiction.diagnostics).toHaveLength(0);
    expect(equalityBranches.diagnostics).toHaveLength(0);
    expect(restoredOriginal.diagnostics).toHaveLength(1);
  });

  it("amortizes mutation and same-reference pairing by control-flow block", () => {
    const buildSource = (pairCount: number): string => {
      const mutations = "items.push(1);".repeat(pairCount);
      const conditions = Array.from(
        { length: pairCount },
        (_, conditionIndex) => `condition${conditionIndex}`,
      );
      const resultExpressions = [
        ...conditions.map((condition) => `(${condition}&&items)`),
        "[...items]",
      ];
      const buildBalancedResultExpression = (startIndex: number, endIndex: number): string => {
        if (endIndex - startIndex === 1) {
          return resultExpressions[startIndex] ?? "[...items]";
        }
        const middleIndex = startIndex + Math.floor((endIndex - startIndex) / 2);
        return `(${buildBalancedResultExpression(startIndex, middleIndex)}||${buildBalancedResultExpression(middleIndex, endIndex)})`;
      };
      const sameReferenceResults = buildBalancedResultExpression(0, resultExpressions.length);
      return `const C=({flag,${conditions.join(",")}})=>{const[,setItems]=useState<number[]>([]);setItems(items=>{if(flag){${mutations}}if(!flag){return ${sameReferenceResults}}return [...items]})}`;
    };
    runRule(noMutateThenSetOrReturnSameReference, buildSource(200));
    const measureFastestDuration = (pairCount: number): number => {
      let fastestDuration = Number.POSITIVE_INFINITY;
      for (let repetition = 0; repetition < 2; repetition += 1) {
        const start = performance.now();
        const result = runRule(noMutateThenSetOrReturnSameReference, buildSource(pairCount));
        fastestDuration = Math.min(fastestDuration, performance.now() - start);
        expect(result.diagnostics).toHaveLength(0);
      }
      return fastestDuration;
    };
    const smallDuration = measureFastestDuration(800);
    const largeDuration = measureFastestDuration(4_000);
    expect(largeDuration).toBeLessThan(smallDuration * 18);
  });
});
