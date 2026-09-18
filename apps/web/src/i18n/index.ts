import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import common from './locales/en/common.json';
import downloader from './locales/en/downloader.json';
import converter from './locales/en/converter.json';
import audiofix from './locales/en/audiofix.json';
import silencecut from './locales/en/silencecut.json';
import image from './locales/en/image.json';
import facetrack from './locales/en/facetrack.json';
import captions from './locales/en/captions.json';

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  resources: {
    en: { common, downloader, converter, audiofix, silencecut, image, facetrack, captions },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
