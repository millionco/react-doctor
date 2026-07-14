// rule: no-chain-state-updates
// weakness: alias-guard
// source: Mailing trial fix-react-rdh-sofn-xyz-mailing-s__f48fwSp

import { useCallback, useEffect, useRef, useState } from "react";

export const Settings = ({ apiKeys }) => {
  const [serverKeys, setServerKeys] = useState(apiKeys);
  const [localKeys, setLocalKeys] = useState(new Map());
  const localKeysRef = useRef(localKeys);
  const commitLocalKeys = useCallback((next) => {
    localKeysRef.current = next;
    setLocalKeys(next);
  }, []);

  useEffect(() => {
    setServerKeys(apiKeys);
    if (localKeysRef.current.size > 0) commitLocalKeys(new Map());
  }, [apiKeys, commitLocalKeys]);

  return <output>{serverKeys.length + localKeys.size}</output>;
};
