// rule: rules-of-hooks
// weakness: library-idiom
// source: synthetic runtime binding regression
// verdict: pass
import { useDeviceLanguage as useLocale } from "firebase/auth";
interface useLocale {}
export const configureLocale = async (auth: object) => {
  useLocale(auth);
};
