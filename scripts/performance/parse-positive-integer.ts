export const parsePositiveInteger = (name: string, value: string, allowZero: boolean): number => {
  const parsedValue = Number.parseInt(value, 10);
  const minimumValue = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimumValue) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimumValue}`);
  }
  return parsedValue;
};
