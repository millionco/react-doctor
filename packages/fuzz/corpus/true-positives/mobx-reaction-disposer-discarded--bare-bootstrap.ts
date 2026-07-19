// rule: mobx-reaction-disposer-discarded
// weakness: name-heuristic
// source: Cursor Bugbot review of PR #1365

import { autorun } from "mobx";

export const bootstrap = (): void => {
  autorun(() => synchronizeStore());
};

declare const synchronizeStore: () => void;
