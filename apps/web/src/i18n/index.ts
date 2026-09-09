import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import common from './locales/en/common.json';
import downloader from './locales/en/downloader.json';
import converter from './locales/en/converter.json';
import audiofix from './locales/en/audiofix.json';
import trimmer from './locales/en/trimmer.json';

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  resources: {
    en: { common, downloader, converter, audiofix, trimmer },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
