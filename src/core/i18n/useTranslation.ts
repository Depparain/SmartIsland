import { useIslandStore } from "../../store/useIslandStore";
import { translations, Language } from "./translations";

export function useTranslation() {
  const language = useIslandStore((s) => s.language) || "ru";
  const setLanguage = useIslandStore((s) => s.setLanguage);

  const t = (key: string, fallback?: string): string => {
    const langDict = translations[language as Language] || translations.ru;
    return (langDict as Record<string, string>)[key] || fallback || key;
  };

  return { t, language, setLanguage };
}
