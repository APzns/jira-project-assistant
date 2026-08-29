import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import MainViewPage from './pages/MainViewPage';
import DashboardsPage from './pages/DashboardsPage';
import ProjectsPage from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectSettingsPage } from './pages/ProjectSettingsPage';
import ReportsPage from './pages/ReportsPage';
import StakeholdersPage from './pages/StakeholdersPage';
import './styles/global.css';

/* ------------------------------------------------------------------ */
/*  Layout: sidebar + content area                                    */
/* ------------------------------------------------------------------ */

function AppLayout() {
  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content-wrapper">
        <div style={{ backgroundColor: '#ff4444', color: 'white', padding: '16px', textAlign: 'center', fontSize: '20px', fontWeight: 'bold', width: '100%', boxSizing: 'border-box', zIndex: 10000 }}>
          🚧 Under Construction: We are upgrading this platform with new AI Project Manager capabilities. Some features may be temporarily unstable.
        </div>
        <header className="topbar">
          <div className="brand">Project Assistant</div>
          <div className="topbar-right">
            <button id="chat-toggle-btn" className="btn-chat-toggle">
              <span className="sparkle">✨</span> Ask AI
            </button>
            <span className="data-freshness" id="data-freshness">Data as of –</span>
          </div>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App: router + route definitions                                   */
/* ------------------------------------------------------------------ */

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<MainViewPage />} />
          <Route path="dashboards" element={<DashboardsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/settings" element={<ProjectSettingsPage />} />
          <Route path="/projects/:key" element={<ProjectDetailPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="stakeholders" element={<StakeholdersPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
