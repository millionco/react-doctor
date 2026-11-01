// rule: rules-of-hooks
// weakness: library-idiom
// source: synthetic runtime binding regression
// verdict: pass
import { useDeviceLanguage as useLocale } from "firebase/auth";
type useLocale = unknown;
export const configureLocale = async (auth: object) => {
  useLocale(auth);
};
