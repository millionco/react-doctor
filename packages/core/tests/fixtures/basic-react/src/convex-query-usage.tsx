import { useQuery } from "convex/react";

// Convex's `useQuery` shares the name but returns the data directly, not a
// tracked `{ data, isLoading, ... }` result object. The import source is
// `convex/react`, so `query-destructure-result` must NOT fire even on a
// spread (#818).
export const ConvexWholeResult = () => {
  const contact = useQuery("contacts:get", { id: "1" });
  return <ContactView {...contact} />;
};

const ContactView = (props: Record<string, unknown>) => <div>{String(props.name)}</div>;
