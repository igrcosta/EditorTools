import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { HomePage } from '../pages/HomePage';
import { FilesPage } from '../features/files/FilesPage';
import { AudioPage } from '../features/audio/AudioPage';
import { ImagePage } from '../features/image/ImagePage';
import { FaceTrackPage } from '../features/facetrack/FaceTrackPage';
import { CaptionsPage } from '../features/captions/CaptionsPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/audio" element={<AudioPage />} />
        <Route path="/image" element={<ImagePage />} />
        <Route path="/video" element={<FaceTrackPage />} />
        <Route path="/captions" element={<CaptionsPage />} />
        {/* Old per-tool routes now live inside a hub. */}
        <Route path="/download" element={<Navigate to="/files" replace />} />
        <Route path="/convert" element={<Navigate to="/files" replace />} />
        <Route path="/audio-fix" element={<Navigate to="/audio" replace />} />
        <Route path="/cut-silence" element={<Navigate to="/audio" replace />} />
        <Route path="/trim-audio" element={<Navigate to="/audio" replace />} />
      </Route>
    </Routes>
  );
}
