// rule: js-min-max-loop
// weakness: copy-tracking
// source: ISSUES_TO_FIX_ASAP.md runtime mutation validation

export const getSmallestAndSortedValues = (values: number[]) => {
  const smallestValue = values.sort((leftValue, rightValue) => leftValue - rightValue)[0];
  return { smallestValue, values };
};
