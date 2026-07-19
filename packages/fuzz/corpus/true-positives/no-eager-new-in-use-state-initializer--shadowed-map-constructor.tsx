// rule: no-eager-new-in-use-state-initializer
// source: PR #1357 aggregate detector audit
import { useState } from "react";

class Map {
  constructor() {
    connectToIndex();
  }
}

export const useSearchIndex = () => useState(new Map());
