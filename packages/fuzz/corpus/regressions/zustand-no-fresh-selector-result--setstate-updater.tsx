// rule: zustand-no-fresh-selector-result
// verdict: pass
// weakness: alias-guard
// source: millionco/react-doctor#1575

import { create } from "zustand";

interface GuidedTourStore {
  guidedTours: Record<string, boolean>;
}

const useGuidedTourStore = create<GuidedTourStore>(() => ({
  guidedTours: {},
}));

const { setState: updateGuidedTourStore } = useGuidedTourStore;
const updateGuidedTourStoreAlias = updateGuidedTourStore;

updateGuidedTourStoreAlias((state) => ({
  guidedTours: { ...state.guidedTours, foo: true },
}));

const setMenuState = useGuidedTourStore.setState;
setMenuState((state) => ({
  guidedTours: state.guidedTours,
}));

updateGuidedTourStore(
  (state) =>
    state.guidedTours["test"] ? {} : { guidedTours: { ...state.guidedTours, test: true } },
  false,
  "addGuidedTour",
);
