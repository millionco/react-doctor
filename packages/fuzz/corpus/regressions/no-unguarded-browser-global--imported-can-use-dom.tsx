// rule: no-unguarded-browser-global-at-module-scope
// weakness: cross-file
// source: PR #1000 adversarial review (fbjs/exenv guard constant lives in another file)
import { canUseDOM } from "@shared/utils/browser";

const initialWidth = canUseDOM ? window.innerWidth : 0;

export const Widget = () => <div style={{ width: initialWidth }} />;
