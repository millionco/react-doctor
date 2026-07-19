// rule: query-floating-mutate-async
// weakness: library-idiom
// source: deep audit of millionco/react-doctor#1000

import { useMutation } from "@tanstack/react-query";
import { DataLoader } from "./data-loader";

export const Loader = () => {
  const mutation = useMutation({ mutationFn: loadData });
  return <DataLoader load={() => mutation.mutateAsync("profile")} />;
};
