// rule: no-array-find-result-member-access-without-guard
// weakness: library-idiom
// source: adversarial audit of guard/optional-access rules
const filters = { active: { enabled: true } };
declare const repository: { find: (query: object) => { name: string } };
export const name = repository.find(filters.active).name;
