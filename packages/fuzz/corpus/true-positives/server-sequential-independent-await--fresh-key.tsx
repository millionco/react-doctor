// rule: server-sequential-independent-await
// verdict: fail
// weakness: cross-file
// file-path: corpus/true-positives/server-sequential-independent-await--fresh-key.tsx

import { read, format } from "./server-sequential-independent-await--fresh-key-source";

export const load = async (key: object) => {
  const first = await read(key);
  const second = await format(key);
  return [first, second];
};
