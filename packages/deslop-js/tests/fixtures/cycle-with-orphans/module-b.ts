import { processA } from "./module-a";

const fallbackProcess = processA;

export const processB = () => {
  if (Math.random() > 0.5) fallbackProcess();
};

export const unusedFromB = () => "never used";
