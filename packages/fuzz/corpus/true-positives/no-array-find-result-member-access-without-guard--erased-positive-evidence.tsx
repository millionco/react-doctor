// rule: no-array-find-result-member-access-without-guard
// verdict: fail
// weakness: name-heuristic
// source: synthetic
const accepts = (item) => item.ready;
interface accepts {}
const records = [{ id: 1, ready: false }];
interface records {}
const alias = records;
type alias = unknown;
export const missingRecord = alias.find(accepts).id;
