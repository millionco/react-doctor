import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `useEffect(() => setX(derive(dep)), [dep])` — derived
// state stored via an effect. Variants probe dep shapes, conditional
// setters, and inline-callback derivations.
export const noDerivedStateEffectCases: FnMiningCase[] = [
  {
    ruleId: "no-derived-state-effect",
    description: "canonical: setFullName(first + ' ' + last) with [first, last] deps",
    filePath: "src/name.tsx",
    code: `
      const FullName = ({ first, last }: NameProps) => {
        const [fullName, setFullName] = useState("");
        useEffect(() => {
          setFullName(first + " " + last);
        }, [first, last]);
        return <span>{fullName}</span>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-derived-state-effect",
    description: "derivation through a helper call: setVisible(getFilteredTodos(todos, filter))",
    filePath: "src/todos.tsx",
    code: `
      const Todos = ({ todos, filter }: TodosProps) => {
        const [visibleTodos, setVisibleTodos] = useState<Todo[]>([]);
        useEffect(() => {
          setVisibleTodos(getFilteredTodos(todos, filter));
        }, [todos, filter]);
        return <List items={visibleTodos} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-derived-state-effect",
    description:
      "derivation with an inline .filter callback: setVisible(todos.filter(t => !t.done))",
    filePath: "src/todos.tsx",
    code: `
      const Todos = ({ todos }: TodosProps) => {
        const [visibleTodos, setVisibleTodos] = useState<Todo[]>([]);
        useEffect(() => {
          setVisibleTodos(todos.filter((t) => !t.done));
        }, [todos]);
        return <List items={visibleTodos} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-derived-state-effect",
    description: "setter wrapped in an if-guard inside the effect",
    filePath: "src/todos.tsx",
    code: `
      const Todos = ({ todos }: TodosProps) => {
        const [count, setCount] = useState(0);
        useEffect(() => {
          if (todos) setCount(todos.length);
        }, [todos]);
        return <span>{count}</span>;
      };
    `,
    shouldFire: false,
    carveOutReason:
      "The rule only inspects top-level ExpressionStatement setters in the effect body — an if-guarded setter is treated as conditional sync logic outside the pure derived-state mirror shape.",
  },
  {
    ruleId: "no-derived-state-effect",
    description: "member-expression dependency: useEffect(..., [user.name])",
    filePath: "src/name.tsx",
    code: `
      const Greeting = ({ user }: { user: User }) => {
        const [greeting, setGreeting] = useState("");
        useEffect(() => {
          setGreeting("Hello " + user.name);
        }, [user.name]);
        return <span>{greeting}</span>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-derived-state-effect",
    description: "two setter statements deriving from the same deps",
    filePath: "src/name.tsx",
    code: `
      const Summary = ({ items }: { items: Item[] }) => {
        const [total, setTotal] = useState(0);
        const [first, setFirst] = useState<Item | null>(null);
        useEffect(() => {
          setTotal(items.length);
          setFirst(items[0]);
        }, [items]);
        return <span>{total}</span>;
      };
    `,
    shouldFire: true,
  },
];
