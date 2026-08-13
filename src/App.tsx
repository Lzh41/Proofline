import { useEffect, useLayoutEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './app/ErrorBoundary';
import { useStoreView } from './app/storeAdapter';
import { applyTheme } from './app/theme';
import { AppShell } from './components/AppShell';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { MistakesPage } from './pages/MistakesPage';
import { PlanPage } from './pages/PlanPage';
import { PlatformsPage } from './pages/PlatformsPage';
import { ProblemsPage } from './pages/ProblemsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SolvePage } from './pages/SolvePage';
import { TodayPage } from './pages/TodayPage';
import { InterviewsPage } from './pages/InterviewsPage';
import { InterviewPracticePage } from './pages/InterviewPracticePage';

function ApplicationRoutes() {
  const store = useStoreView();

  useEffect(() => {
    void store.initialize?.();
  }, [store.initialize]);

  useLayoutEffect(() => applyTheme(store.settings.theme ?? 'dark'), [store.settings.theme]);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/platforms" element={<PlatformsPage />} />
        <Route path="/platforms/:source" element={<PlatformsPage />} />
        <Route path="/problems" element={<ProblemsPage />} />
        <Route path="/problems/import" element={<ProblemsPage />} />
        <Route path="/problems/:id" element={<SolvePage />} />
        <Route path="/interviews" element={<InterviewsPage />} />
        <Route path="/interviews/:id" element={<InterviewPracticePage />} />
        <Route path="/solve" element={<SolvePage />} />
        <Route path="/solve/:id" element={<SolvePage />} />
        <Route path="/mistakes" element={<MistakesPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/:id" element={<KnowledgePage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <ApplicationRoutes />
      </HashRouter>
    </ErrorBoundary>
  );
}
