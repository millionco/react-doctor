// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: nested-function
// source: adversarial audit of guard/optional-access rules
export const read = (key: string): number => {
  const values = new Map<string, number>();
  const _populate = (): void => {
    values.set(key, 1);
  };
  return values.get(key)!.valueOf();
};

export const readAfterDelete = (key: string): number => {
  const values = new Map<string, number>();
  values.set(key, 1);
  values.delete(key);
  return values.get(key)!.valueOf();
};
