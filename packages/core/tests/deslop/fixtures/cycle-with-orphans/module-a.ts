import { processB } from "./module-b";

export const processA = () => {
  processB();
};

export const unusedFromA = () => "never used";
