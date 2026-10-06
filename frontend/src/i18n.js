import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import hi from './locales/hi';
import mr from './locales/mr';

const SUPPORTED = ['en', 'hi', 'mr'];
const STORAGE_KEY = 'pmc_language';

const savedLanguage = (() => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.includes(value) ? value : 'en';
  } catch {
    return 'en';
  }
})();

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, hi: { translation: hi }, mr: { translation: mr } },
    lng: savedLanguage,
    fallbackLng: 'en',
    // Keys are flat strings that may contain "." or ":" (e.g. "dept.Traffic Police / RTO").
    keySeparator: false,
    nsSeparator: false,
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

const applyLanguage = (lng) => {
  document.documentElement.lang = lng;
  try { localStorage.setItem(STORAGE_KEY, lng); } catch { /* storage unavailable */ }
};
applyLanguage(i18n.language);
i18n.on('languageChanged', applyLanguage);

export default i18n;
