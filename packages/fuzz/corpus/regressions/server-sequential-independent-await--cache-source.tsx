// rule: server-sequential-independent-await
// weakness: cross-file
// source: aidenybai/react-grab@a307f9bf57075bcc323fcdd44d24f1179faaee03
const cache = new WeakMap<object, Promise<string>>();

export const read = (key: object) => {
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = fetch("/value").then((response) => response.text());
  cache.set(key, promise);
  return promise;
};

export const format = async (key: object) => {
  const value = await read(key);
  const names = getNames();
  return names.map((name) => name.toUpperCase()).join("") + value;
};

const getNames = (): string[] => ["cached"];
