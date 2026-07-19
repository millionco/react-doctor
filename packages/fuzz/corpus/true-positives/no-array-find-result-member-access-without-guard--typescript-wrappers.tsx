// rule: no-array-find-result-member-access-without-guard
// weakness: wrapper-transparency
// source: adversarial audit of guard/optional-access rules
declare const rows: Array<{ active: boolean; name: string }>;
const isActive = (row: { active: boolean }): boolean => row.active;
export const name = (rows.find(isActive as typeof isActive) as { name: string }).name;
