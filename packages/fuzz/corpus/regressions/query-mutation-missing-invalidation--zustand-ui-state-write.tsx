// verdict: fail
// rule: query-mutation-missing-invalidation
// weakness: library-idiom
// source: GitHub issue #1786 (counter-example: a UI-state store write is not a re-sync)
import { useMutation } from "@tanstack/react-query";
import { create } from "zustand";

declare const api: { archiveProject: (id: string) => Promise<void> };
const useUiStore = create(() => ({ isDialogOpen: false }));

export function useArchiveProject() {
  return useMutation({
    mutationFn: (id: string) => api.archiveProject(id),
    onSuccess: () => {
      useUiStore.setState({ isDialogOpen: false });
    },
  });
}
