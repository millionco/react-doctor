// rule: zustand-no-mutating-state
// weakness: provenance
// source: Cursor Bugbot review on millionco/react-doctor#1410

import { create } from "zustand";

export const useFuzzStore = create(() => ({ items: [] as string[] }));
export const useOtherFuzzStore = create(() => ({ items: [] as string[] }));

const items = useFuzzStore.getState().items;
items.push("next");
useOtherFuzzStore.setState({ items: [] });
