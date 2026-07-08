import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `const { data, ...rest } = useQuery(...)` subscribes to
// every result field. Variants probe import aliasing, namespace calls,
// and two-step destructuring.
export const queryNoRestDestructuringCases: FnMiningCase[] = [
  {
    ruleId: "query-no-rest-destructuring",
    description: "canonical: rest destructure of useQuery",
    filePath: "src/todos.tsx",
    code: `
      import { useQuery } from "@tanstack/react-query";
      const { data, ...rest } = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });
    `,
    shouldFire: true,
  },
  {
    ruleId: "query-no-rest-destructuring",
    description: "aliased import: import { useQuery as useTodosQuery }",
    filePath: "src/todos.tsx",
    code: `
      import { useQuery as useTodosQuery } from "@tanstack/react-query";
      const { data, ...rest } = useTodosQuery({ queryKey: ["todos"], queryFn: fetchTodos });
    `,
    shouldFire: true,
  },
  {
    ruleId: "query-no-rest-destructuring",
    description: "two-step: bind the result, then rest-destructure the binding",
    filePath: "src/todos.tsx",
    code: `
      import { useQuery } from "@tanstack/react-query";
      const queryResult = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });
      const { data, ...rest } = queryResult;
    `,
    shouldFire: true,
  },
  {
    ruleId: "query-no-rest-destructuring",
    description: "useSuspenseQuery rest destructure",
    filePath: "src/todos.tsx",
    code: `
      import { useSuspenseQuery } from "@tanstack/react-query";
      const { data, ...rest } = useSuspenseQuery({ queryKey: ["todos"], queryFn: fetchTodos });
    `,
    shouldFire: true,
  },
  {
    ruleId: "query-no-rest-destructuring",
    description: "namespace call: ReactQuery.useQuery(...)",
    filePath: "src/todos.tsx",
    code: `
      import * as ReactQuery from "@tanstack/react-query";
      const { data, ...rest } = ReactQuery.useQuery({ queryKey: ["todos"], queryFn: fetchTodos });
    `,
    shouldFire: true,
  },
];
