import { Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { HomePage } from '../pages/HomePage';
import { DownloadPage } from '../features/downloader/DownloadPage';
import { ConvertPage } from '../features/converter/ConvertPage';
import { AudioFixPage } from '../features/audiofix/AudioFixPage';
import { SilenceCutPage } from '../features/silencecut/SilenceCutPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/convert" element={<ConvertPage />} />
        <Route path="/audio-fix" element={<AudioFixPage />} />
        <Route path="/cut-silence" element={<SilenceCutPage />} />
      </Route>
    </Routes>
  );
}
