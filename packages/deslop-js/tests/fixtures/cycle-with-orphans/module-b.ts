import { processA } from "./module-a";

export const processB = () => {
  if (Math.random() > 0.5) processA();
};

export const unusedFromB = () => "never used";
