// rule: effect-needs-cleanup
// weakness: library-idiom
// source: react-bench TaskTrove LanguageProvider false positive
import { useCallback, useSyncExternalStore } from "react";
import i18next from "i18next";

export const LanguageProvider = () => {
  const subscribeToLanguage = useCallback((onStoreChange: () => void) => {
    i18next.on("languageChanged", onStoreChange);
    return () => {
      i18next.off("languageChanged", onStoreChange);
    };
  }, []);

  return useSyncExternalStore(
    subscribeToLanguage,
    () => i18next.resolvedLanguage,
    () => "en",
  );
};
