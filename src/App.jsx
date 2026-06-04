import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom'
import PageHeader from './components/PageHeader'
import Home from './pages/Landing/Home'
import Login from './pages/Landing/Login'
import GetStarted from './pages/Landing/GetStarted'
import Dashboard from './pages/Dashboard'
import OpportunityDetail from './pages/OpportunityDetail'
import CukaiVault from './pages/CukaiVault'
import CukaiBot from './pages/CukaiBot'
import InsightsInbox from './pages/InsightsInbox'
import UserDocs from './pages/UserDocs'
import ManageAccount from './pages/Account/ManageAccount'
import TermsConditions from './pages/Account/TermsConditions'
import './App.css'

// 1. A wrapper that protects internal pages
function ProtectedLayout({ isAuthenticated }) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <>
      <PageHeader />
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
          <Route path="/getstarted" element={<GetStarted />} />
        </Route>

        {/* PROTECTED ROUTES (Accessible only when logged in) */}
        <Route element={<ProtectedLayout isAuthenticated={isAuthenticated} />}>
          <Route path="/overview" element={<Dashboard />} />
          <Route path="/vault" element={<CukaiVault />} />
          <Route path="/cukaibot" element={<CukaiBot />} />
          <Route path="/insightsinbox" element={<InsightsInbox />} />
          <Route path="/userdocs" element={<UserDocs />} />
          <Route path="/manageaccount/*" element={<ManageAccount />} />
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