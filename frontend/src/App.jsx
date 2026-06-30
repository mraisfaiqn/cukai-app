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

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  
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