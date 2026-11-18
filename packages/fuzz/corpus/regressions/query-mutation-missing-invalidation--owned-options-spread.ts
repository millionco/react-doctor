// rule: query-mutation-missing-invalidation
// weakness: owned-mutation-lifecycle-spread
// source: synthetic audit regression
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveItems } from "./items";
export function useItemsMutation() {
  const queryClient = useQueryClient();
  const lifecycle = { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }) };
  return useMutation({ ...lifecycle, mutationFn: saveItems, retry: false });
}
