import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import PageHeader from './components/PageHeader'
import Home from './pages/Landing/Home'
import Login from './pages/Landing/Login'
import GetStarted from './pages/Landing/GetStarted'
import Overview from './pages/Dashboard/Overview'
import OpportunityDetail from './pages/Dashboard/OpportunityDetail'
import CukaiAccount from './pages/CukaiAccount'
import CukaiBot from './pages/CukaiBot'
import InsightsInbox from './pages/InsightsInbox'
import Documentation from './pages/Documentation'
import ManageAccount from './pages/Account/ManageAccount'
import TermsConditions from './pages/Account/TermsConditions'
import FormBValues from './pages/Embed/FormBValues'
import * as API from './services/api'

// 1. A wrapper that protects internal pages
function ProtectedLayout({ isAuthenticated, onLogout }) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <>
      {/* FIX: Passed the 'onLogout' prop down to the PageHeader component */}
      <PageHeader onLogout={onLogout} />
      <main className="app-content"> {/* Optional wrapper for your CSS styling */}
        <Outlet /> {/* This renders whatever sub-route the user is on */}
      </main>
    </>
  )
}

// 2. A wrapper that stops logged-in users from seeing public pages (like /login)
function PublicLayout({ isAuthenticated }) {
  if (isAuthenticated) {
    return <Navigate to="/overview" replace />
  }
  return <Outlet />
}

// 3. A chrome-free layout for the browser-extension side panel. These routes
// (/embed/*) are meant to be loaded inside an <iframe> in the extension: no
// PageHeader, no app nav — just the bare feature, sized to fill the panel.
// Auth still applies, but because the iframe is same-origin as the web app it
// shares the app's localStorage session, so logging into the app in a normal
// tab automatically authenticates the panel too (this is what fixes the
// "not logged in / no documents found" problem the standalone panel had).
function EmbedLayout({ isAuthenticated }) {
  if (!isAuthenticated) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#64748B', fontSize: 13, lineHeight: 1.6 }}>
        <div>
          <p style={{ fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Please log in first</p>
          Open the Cukai app in a browser tab and sign in — then reopen this panel.
        </div>
      </div>
    )
  }
  return <div style={{ height: '100vh', overflow: 'hidden' }}><Outlet /></div>
}

function App() {
  // Initialise from localStorage instead of always starting false — LoginPanel
  // already saves userId there on a successful login, but nothing was ever
  // reading it back on startup, so every refresh reset isAuthenticated to
  // false and bounced the user back to /login even though they were still
  // logged in. This is a lightweight "trust the browser" check (Approach 1);
  // once account deletion/suspension exists, this should be upgraded to also
  // verify the user against the backend on load (Approach 2).
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('userId'))
  
  return (
    <Router>
      <Routes>
        {/* PUBLIC ROUTES (Accessible only when logged out) */}
        <Route element={<PublicLayout isAuthenticated={isAuthenticated} />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login onLogin={() => setIsAuthenticated(true)} />} />
          <Route path="/getstarted" element={<GetStarted onLogin={() => setIsAuthenticated(true)} />} />
        </Route>

        {/* PROTECTED ROUTES (Accessible only when logged in) */}
        <Route element={<ProtectedLayout isAuthenticated={isAuthenticated} onLogout={() => setIsAuthenticated(false)}/>}>
          <Route path="/overview" element={<Overview />} />
          <Route path="/account" element={<CukaiAccount />} />
          <Route path="/cukaibot" element={<CukaiBot />} />
          <Route path="/insightsinbox" element={<InsightsInbox />} />
          <Route path="/documentation" element={<Documentation />} />
          <Route path="/manageaccount" element={<ManageAccount />} />
          <Route path="/opportunities/:id" element={<OpportunityDetail />} />
          <Route path="/termsconditions" element={<TermsConditions />} />
        </Route>

        {/* EMBED ROUTES (loaded inside the browser-extension side panel iframe) */}
        <Route element={<EmbedLayout isAuthenticated={isAuthenticated} />}>
          <Route path="/embed/cukaibot" element={<CukaiBot embed />} />
          <Route path="/embed/formb" element={<FormBValues />} />
        </Route>

        {/* Global Catch-all Fallback */}
        <Route 
          path="*" 
          element={<Navigate to={isAuthenticated ? "/overview" : "/"} replace />} 
        />
      </Routes>
    </Router>
  )
}

export default App;