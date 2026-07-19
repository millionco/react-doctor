// rule: no-eager-new-in-use-state-initializer
// weakness: alias-guard
// source: PR #1357 aggregate detector audit
import { useState } from "react";

const NativeMap = Map;
const StableMap = NativeMap;

export const useStableMap = () => useState(new StableMap());
