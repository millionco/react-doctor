import { useQuery } from "@tanstack/react-query";

// Spreading a genuine TanStack `useQuery` result enumerates every field, so
// `query-destructure-result` fires. The import source is `@tanstack/react-query`.
export const TanstackWholeResult = () => {
  const query = useQuery({ queryKey: ["todos"], queryFn: () => fetch("/api/todos") });
  return <TodoView {...query} />;
};

const TodoView = (props: Record<string, unknown>) => <div>{String(props.data)}</div>;
