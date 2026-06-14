import { useQuery } from "convex/react";

// Convex's `useQuery` shares the name but returns a single value, not a
// `{ data, isLoading, ... }` result object. The import source is `convex/react`,
// so `query-destructure-result` must NOT fire here (#818).
export const ConvexWholeResult = () => {
  const contact = useQuery("contacts:get", { id: "1" });
  return <div>{String(contact)}</div>;
};
