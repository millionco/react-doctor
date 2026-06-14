import { useQuery } from "@tanstack/react-query";

// A whole-result assignment from a genuine TanStack `useQuery` import — the
// import source is `@tanstack/react-query`, so `query-destructure-result` fires.
export const TanstackWholeResult = () => {
  const query = useQuery({ queryKey: ["todos"], queryFn: () => fetch("/api/todos") });
  return <div>{String(query.data)}</div>;
};
