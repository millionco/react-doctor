// rule: no-unescaped-dynamic-string-in-regexp
// weakness: alias-guard
// source: synthetic escaped own search slot
// verdict: pass
class SearchStore {
  filter = "";
  setFilter(value: string) {
    this.filter = RegExp.escape(value);
  }
  matches(value: string) {
    return new RegExp(this.filter, "i").test(value);
  }
}
export default new SearchStore();
