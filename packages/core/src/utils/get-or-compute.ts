export const getOrCompute = <Key, Value>(
  cache: Map<Key, Value> | null,
  key: Key,
  compute: () => Value,
): Value => {
  if (cache === null) return compute();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = compute();
  cache.set(key, value);
  return value;
};
