export const parsePositiveInteger = (name: string, value: string, allowZero: boolean): number => {
  const parsedValue = Number(value);
  const minimumValue = allowZero ? 0 : 1;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsedValue) || parsedValue < minimumValue) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimumValue}`);
  }
  return parsedValue;
};
