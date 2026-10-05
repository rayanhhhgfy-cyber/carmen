import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import QueuePage from './pages/QueuePage';
import SettingsPage from './pages/SettingsPage';
import CollectionPage from './pages/CollectionPage';
import { PlayerProvider } from './player/PlayerContext';
import { ThemeProvider } from './theme/ThemeContext';

export default function App() {
  return (
    <ThemeProvider>
      <PlayerProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="queue" element={<QueuePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="collection/:kind/:id" element={<CollectionPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </PlayerProvider>
    </ThemeProvider>
  );
}
