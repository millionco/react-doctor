// rule: no-flush-sync
// weakness: library-idiom
// source: react-bench write-react-softmaple-softmaple pdH5s6A

import type { PositionOperation } from "@softmaple/awareness/mapping";
import { flushSync } from "react-dom";

export const applyRemoteEvents = (operations: PositionOperation[]): void => {
  flushSync(() => {
    setSynced({
      text: readRemoteText(),
      remoteOperations: operations,
    });
  });
};
