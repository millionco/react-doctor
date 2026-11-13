// rule: no-array-find-result-member-access-without-guard
// weakness: name-heuristic
// source: independently synthetic runtime parameter-property provider
// verdict: pass

class Setup {
  constructor(public value = Function("Array.prototype.find = () => ({ name: 'custom' })")()) {}
}
new Setup();
const ITEMS = [{ name: "first", enabled: false }];
export const read = () => ITEMS.find((item) => item.enabled).name;
