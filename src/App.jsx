import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import MainHeader from './components/MainHeader'
import PageHeader from './components/PageHeader'
import Home from './pages/Landing/Home'
import Pricing from './pages/Landing/Pricing'
import AppTools from './pages/Landing/AppTools'
import AboutUs from './pages/Landing/AboutUs'
import Login from './pages/Landing/Login'
import GetStarted from './pages/Landing/GetStarted'
import Dashboard from './pages/Dashboard'
import CukaiVault from './pages/CukaiVault'
import CukaiBot from './pages/CukaiBot'
import InsightsInbox from './pages/InsightsInbox'
import UserDocs from './pages/UserDocs'
import ManageAccount from './pages/Account/ManageAccount'
import TermsConditions from './pages/Account/TermsConditions'
import './App.css'

// MainHeader is hidden on the landing home page because Home.jsx renders its own
// full-featured landing nav (with section anchors, language switcher, etc.)
function ConditionalMainHeader() {
  const { pathname } = useLocation()
  if (pathname === '/') return null
  return <MainHeader />
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  return (
    <>
      <Router>
        {isAuthenticated ? (
          <>
            <PageHeader />
            <Routes>
              <Route path="/overview" element={<Dashboard />} />
              <Route path="/vault" element={<CukaiVault />} />
              <Route path="/cukaibot" element={<CukaiBot />} />
              <Route path="/insightsinbox" element={<InsightsInbox />} />
              <Route path="/userdocs" element={<UserDocs />} />
              <Route path="/manageaccount/*" element={<ManageAccount />} />
              <Route path="/termsconditions" element={<TermsConditions />} />
              {/* Catch-all: redirect any other path to overview when logged in */}
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </>
        ) : (
          <>
            <ConditionalMainHeader />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login onLogin={() => setIsAuthenticated(true)} />} />
              <Route path="/getstarted" element={<GetStarted />} />
              {/* Catch-all: redirect any other path to home when logged out */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </>
        )}
      </Router>
    </>
  )
}

export default App;