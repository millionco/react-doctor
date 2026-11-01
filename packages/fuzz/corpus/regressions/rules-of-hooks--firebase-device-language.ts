// rule: rules-of-hooks
// weakness: library-idiom
// source: synthetic API-role regression
// verdict: pass
import { useDeviceLanguage as useLanguage } from "@react-native-firebase/app/dist/module/internal/web/firebaseAuth";

export const configureLanguage = async (auth: object) => {
  useLanguage(auth);
};
