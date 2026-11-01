// rule: no-unescaped-dynamic-string-in-regexp
// weakness: erased-runtime-binding
// source: independently synthetic own-field runtime binding
// verdict: fail
interface RegExp {}
class SearchStore {
  filter = "";
  setFilter(value) {
    this.filter = value;
  }
  matches(value) {
    return new RegExp(this.filter, "i").test(value);
  }
}
export default new SearchStore();
