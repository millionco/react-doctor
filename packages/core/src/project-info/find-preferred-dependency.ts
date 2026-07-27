export interface PreferredDependency<Value> {
  readonly dependencyName: string;
  readonly value: Value;
}

interface FindPreferredDependencyOptions<Value> {
  readonly dependencyNames: ReadonlyArray<string>;
  readonly getValue: (dependencyName: string) => Value | null;
}

export const findPreferredDependency = <Value>({
  dependencyNames,
  getValue,
}: FindPreferredDependencyOptions<Value>): PreferredDependency<Value> | null => {
  for (const dependencyName of dependencyNames) {
    const value = getValue(dependencyName);
    if (value !== null) return { dependencyName, value };
  }
  return null;
};
