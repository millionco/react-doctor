// rule: no-dynamic-import-path, no-full-lodash-import
// weakness: library-idiom
// source: FP-FIX history (bundler context modules; type-only imports don't ship)
import type { Dictionary } from "lodash";

export const loadLocale = (lang: string) => import(`./locales/${lang}.js`);
export type LocaleTable = Dictionary<string>;
