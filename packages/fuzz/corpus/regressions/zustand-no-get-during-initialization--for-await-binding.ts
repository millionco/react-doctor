// weakness: control-flow
// source: Cursor Bugbot review on PR #1407
import { create } from "zustand";

export const useFuzzStore = create(async (_set, get) => {
  for await (get().current of loadItems()) {
    get().consume();
  }
  return { count: 0 };
});
