// rule: zustand-no-mutating-state
// weakness: library-idiom
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export const useStore = create(immer(() => ({ count: 0 })));

useStore.setState((state) => void state.count++);
