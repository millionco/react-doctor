// rule: no-unescaped-dynamic-string-in-regexp
// weakness: control-flow
// source: independently synthetic own-field terminal writer
// verdict: pass
class SearchStore {
  filter = "";
  setFilter(value, shouldStop) {
    try {
      this.filter = value;
    } finally {
      this.filter = "fixed";
    }
  }
  matches(value) {
    return new RegExp(this.filter, "i").test(value);
  }
}
export default new SearchStore();
