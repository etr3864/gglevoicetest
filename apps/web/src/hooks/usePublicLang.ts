import { useState } from 'react';

const LANG_KEY = 'optive_lang';
export type PublicLang = 'en' | 'he';

export function usePublicLang() {
  const [lang, setLangState] = useState<PublicLang>(
    () => (localStorage.getItem(LANG_KEY) as PublicLang) ?? 'en'
  );

  const setLang = (l: PublicLang) => {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  };

  return { lang, setLang, dir: lang === 'he' ? 'rtl' : 'ltr' } as const;
}
