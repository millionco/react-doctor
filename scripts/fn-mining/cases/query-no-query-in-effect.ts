import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: calling `refetch()` from `useEffect` duplicates work
// React Query schedules itself. Variants probe callee shapes (member
// call on the query object) and nesting.
export const queryNoQueryInEffectCases: FnMiningCase[] = [
  {
    ruleId: "query-no-query-in-effect",
    description: "canonical: destructured refetch() called in the effect",
    filePath: "src/todos.tsx",
    code: `
      const Todos = ({ userId }: { userId: string }) => {
        const { data, refetch } = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });
        useEffect(() => {
          refetch();
        }, [userId]);
        return <List items={data} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "query-no-query-in-effect",
    description: "member call on the query object: query.refetch()",
    filePath: "src/todos.tsx",
    code: `
      const Todos = ({ userId }: { userId: string }) => {
        const query = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });
        useEffect(() => {
          query.refetch();
        }, [userId]);
        return <List items={query.data} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "query-no-query-in-effect",
    description: "refetch inside a promise .then callback in the effect",
    filePath: "src/todos.tsx",
    code: `
      const Todos = ({ userId }: { userId: string }) => {
        const { data, refetch } = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });
        useEffect(() => {
          warmCache(userId).then(() => refetch());
        }, [userId]);
        return <List items={data} />;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "query-no-query-in-effect",
    description: "refetch scheduled through setTimeout inside the effect",
    filePath: "src/todos.tsx",
    code: `
      const Todos = ({ userId }: { userId: string }) => {
        const { data, refetch } = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });
        useEffect(() => {
          const timer = setTimeout(() => refetch(), 500);
          return () => clearTimeout(timer);
        }, [userId]);
        return <List items={data} />;
      };
    `,
    shouldFire: false,
    carveOutReason:
      "Refetch inside timer callbacks registered by the effect is carved out like setInterval — the callback is a nested handler, not synchronous effect-body work (see query-no-query-in-effect.regressions.test.ts).",
  },
  {
    ruleId: "query-no-query-in-effect",
    description: "void refetch() expression statement",
    filePath: "src/todos.tsx",
    code: `
      const Todos = ({ userId }: { userId: string }) => {
        const { data, refetch } = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });
        useEffect(() => {
          void refetch();
        }, [userId]);
        return <List items={data} />;
      };
    `,
    shouldFire: true,
  },
];
