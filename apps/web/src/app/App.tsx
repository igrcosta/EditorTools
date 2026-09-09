import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { HomePage } from '../pages/HomePage';
import { DownloadPage } from '../features/downloader/DownloadPage';
import { ConvertPage } from '../features/converter/ConvertPage';
import { AudioPage } from '../features/audio/AudioPage';
import { ImagePage } from '../features/image/ImagePage';
import { FaceTrackPage } from '../features/facetrack/FaceTrackPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/convert" element={<ConvertPage />} />
        <Route path="/audio" element={<AudioPage />} />
        <Route path="/image" element={<ImagePage />} />
        <Route path="/video" element={<FaceTrackPage />} />
        {/* Old per-tool routes now live inside the audio hub. */}
        <Route path="/audio-fix" element={<Navigate to="/audio" replace />} />
        <Route path="/cut-silence" element={<Navigate to="/audio" replace />} />
        <Route path="/trim-audio" element={<Navigate to="/audio" replace />} />
      </Route>
    </Routes>
  );
}
