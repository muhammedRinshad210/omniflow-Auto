import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './toast';
import { AppShell } from './AppShell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Inbox } from './pages/Inbox';
import { Customers } from './pages/Customers';
import { Replies } from './pages/Replies';
import { Channels } from './pages/Channels';
import { Settings } from './pages/Settings';
import { LoadingBlock } from './ui';

function Protected({ children }: { children: React.ReactNode }) {
  const { authed, ready } = useAuth();
  if (!ready) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingBlock label="Checking session…" />
      </div>
    );
  }
  if (!authed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <Protected>
                  <AppShell />
                </Protected>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/inbox/:conversationId" element={<Inbox />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/replies" element={<Replies />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
