// rule: rules-of-hooks
// verdict: pass
// weakness: alias-guard
// source: synthetic immutable alias of a local scalar function

const formatTitle = (title: string) => title + "!";
const useTitle = formatTitle;

export const prepareTitle = async () => useTitle("Ready");
