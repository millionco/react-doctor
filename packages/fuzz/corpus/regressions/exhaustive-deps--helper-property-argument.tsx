// rule: exhaustive-deps
// verdict: safe
import { useMemo } from "react";
const buildItems = (settings) => (settings.items || []).map((item) => item.name);
export const View = ({ config }) => useMemo(() => buildItems(config), [config.items]);
