import { Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { HomePage } from '../pages/HomePage';
import { DownloadPage } from '../features/downloader/DownloadPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/download" element={<DownloadPage />} />
      </Route>
    </Routes>
  );
}
