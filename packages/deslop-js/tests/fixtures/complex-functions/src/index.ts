export const simpleFn = (a: number): number => a + 1;

export const tangledFn = (a: number, b: number, c: number, d: number, e: number): number => {
  let result = 0;
  if (a > 0) {
    if (b > 0) {
      for (let index = 0; index < c; index++) {
        if (d > 0 && e > 0) {
          result += index * 2;
        } else if (d > 0 || e > 0) {
          result += index;
        }
      }
    }
  } else if (a < -10) {
    while (b < 0) {
      result -= 1;
      if (c > 0 && d > 0) result += 1;
    }
  } else {
    try {
      result = a / b;
    } catch (error) {
      if (error) result = -1;
    }
  }
  return result;
};
