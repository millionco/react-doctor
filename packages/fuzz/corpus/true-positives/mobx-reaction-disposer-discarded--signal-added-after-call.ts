import { autorun } from "mobx";

const controller = new AbortController();

export const startTracking = () => {
  const options = {};
  autorun(() => sync(), options);
  options.signal = controller.signal;
};

declare const sync: () => void;
