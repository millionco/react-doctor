// rule: no-unescaped-dynamic-string-in-regexp
// weakness: alias-guard
// source: synthetic raw own search slot
// verdict: fail
class SearchStore {
  filter = "";
  setFilter(value: string) {
    this.filter = value;
  }
  matches(value: string) {
    return new RegExp(this.filter, "i").test(value);
  }
}
export default new SearchStore();
