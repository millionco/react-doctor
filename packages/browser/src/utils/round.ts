// Round a millisecond/percent value to two decimals, so profile analyses read
// cleanly instead of carrying float noise like 3.1999999999998.
export const roundToHundredths = (value: number): number => Math.round(value * 100) / 100;
