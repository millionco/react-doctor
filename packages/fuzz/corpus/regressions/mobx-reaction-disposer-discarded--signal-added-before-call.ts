import { autorun } from "mobx";

const controller = new AbortController();

export const startTracking = () => {
  const options = {};
  options.signal = controller.signal;
  autorun(() => sync(), options);
};

declare const sync: () => void;
