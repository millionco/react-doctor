// rule: server-sequential-independent-await
// weakness: cross-file

const cache = new WeakMap<object, Promise<Response>>();
const makeKey = (value: object) => ({ value });

export const read = (value: object) => {
  const key = makeKey(value);
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = fetch("/value");
  cache.set(key, promise);
  return promise;
};

export const format = async (value: object) => String(await read(value));
