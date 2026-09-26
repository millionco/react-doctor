// rule: server-sequential-independent-await
// weakness: cross-file
// source: aidenybai/react-grab@a307f9bf57075bcc323fcdd44d24f1179faaee03
// verdict: pass
// file-path: corpus/regressions/server-sequential-independent-await--cross-file-cache.tsx
import { read, format } from "./server-sequential-independent-await--cache-source";

export const load = async (key: object) => {
  const [value] = await Promise.all([read(key)]);
  const text = await format(key);
  return [value, text];
};
