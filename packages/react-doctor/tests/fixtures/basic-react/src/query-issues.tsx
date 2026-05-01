import { useEffect, useState } from "react";

const useQuery = (options: any) => ({
  data: null,
  isLoading: false,
  error: null,
  refetch: () => {},
});
const useMutation = (options: any) => ({ mutate: () => {} });
const QueryClient = class {
  constructor(options?: any) {}
};
const QueryClientProvider = ({ client, children }: any) => children;
const queryClient = { invalidateQueries: (_opts: any) => {} };

const UnstableQueryClient = () => {
  const client = new QueryClient({ defaultOptions: {} });
  return <QueryClientProvider client={client}>Hello</QueryClientProvider>;
};

const RestDestructuring = () => {
  const { data, ...rest } = useQuery({
    queryKey: ["todos"],
    queryFn: () => fetch("/api/todos"),
  });
  return <div>{JSON.stringify(rest)}</div>;
};

const VoidQueryFn = () => {
  const result = useQuery({
    queryKey: ["empty"],
    queryFn: () => {},
  });
  return <div />;
};

const RefetchInEffect = () => {
  const { data, refetch } = useQuery({
    queryKey: ["items"],
    queryFn: () => fetch("/api/items"),
  });

  useEffect(() => {
    refetch();
  }, []);

  return <div>{JSON.stringify(data)}</div>;
};

const MutationMissingInvalidation = () => {
  const mutation = useMutation({
    mutationFn: (newTodo: any) =>
      fetch("/api/todos", { method: "POST", body: JSON.stringify(newTodo) }),
  });
  return <button onClick={() => mutation.mutate({ title: "New" })}>Add</button>;
};

// Regression: setQueryData (in-place patch) is a valid cache-update
// pattern and must not fire `query-mutation-missing-invalidation`.
// Pre-fix, only `invalidateQueries` was treated as a sync — this hit
// every code path that used setQueryData / resetQueries / etc.
const setQueryDataClient = { setQueryData: (_key: any, _value: any) => {} };
const MutationWithSetQueryData = () => {
  const mutation = useMutation({
    mutationFn: (newTodo: any) =>
      fetch("/api/todos", { method: "POST", body: JSON.stringify(newTodo) }),
    onSuccess: (created: any) => {
      setQueryDataClient.setQueryData(["todos"], (old: any) => [...old, created]);
    },
  });
  return <button onClick={() => mutation.mutate({ title: "New" })}>Add</button>;
};

const UseQueryForMutation = () => {
  const result = useQuery({
    queryKey: ["create-user"],
    queryFn: () => fetch("/api/users", { method: "POST", body: JSON.stringify({ name: "John" }) }),
  });
  return <div />;
};

export {
  UnstableQueryClient,
  RestDestructuring,
  VoidQueryFn,
  RefetchInEffect,
  MutationMissingInvalidation,
  MutationWithSetQueryData,
  UseQueryForMutation,
};
