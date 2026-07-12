declare const mutateValues: (values: number[]) => void;
declare const getValue: () => number;

export const checkCallerOwnedValues = (candidates: number[], values: number[]): void => {
  for (const candidate of candidates) values.includes(candidate);
};

export const checkEscapedLocalValues = (candidates: number[]): void => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const candidate of candidates) {
    mutateValues(values);
    values.includes(candidate);
  }
};

export const checkFreshDynamicValues = (candidates: number[]): void => {
  for (const candidate of candidates) {
    [getValue(), 2, 3, 4, 5, 6, 7, 8, 9].includes(candidate);
  }
};
