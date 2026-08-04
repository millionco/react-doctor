import { create } from "zustand";

interface GuidedTourStore {
  guidedTours: Record<string, any>;
}

const useGuidedTourStore = create<GuidedTourStore>((set) => ({
  guidedTours: {},
}));

const { setState } = useGuidedTourStore;

setState((state) => ({
  guidedTours: { ...state.guidedTours, foo: "bar" },
}));

const setMenuState = useGuidedTourStore.setState;
setMenuState((state) => ({
  guidedTours: state.guidedTours,
}));

setState(
  (state) =>
    state.guidedTours["test"]
      ? {}
      : { guidedTours: { ...state.guidedTours, test: true } },
  false,
  "addGuidedTour",
);
