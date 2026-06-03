<<<<<<< Updated upstream
import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import MainHeader from './components/MainHeader'
import PageHeader from './components/PageHeader'
import Home from './pages/Landing/Home'
import Pricing from './pages/Landing/Pricing'
import AppFeatures from './pages/Landing/AppFeatures'
import Docs from './pages/Landing/Docs'
import Login from './pages/Landing/Login'
import GetStarted from './pages/Landing/GetStarted'
import Dashboard from './pages/Dashboard'
import ReceiptVault from './pages/ReceiptVault'
import ReportGeneration from './pages/ReportGeneration'
import CukaiBot from './pages/CukaiBot'
import UserNotifications from './pages/UserNotifications'
import UserDocs from './pages/UserDocs'
import UserProfile from './pages/Account/UserProfile'
import AccountManager from './pages/Account/AccountManager'
import TermsConditions from './pages/Account/TermsConditions'
=======
import PageHeader from './components/PageHeader'
import Dashboard from './pages/Dashboard'
>>>>>>> Stashed changes
import './App.css'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  return (
    <>
<<<<<<< Updated upstream
      <Router>
        {isAuthenticated ? (
          <>
            <PageHeader />
            <Routes>
              <Route path="/overview" element={<Dashboard />} />
              <Route path="/vault" element={<ReceiptVault />} />
              <Route path="/reports" element={<ReportGeneration />} />
              <Route path="/cukaibot" element={<CukaiBot />} />
              <Route path="/usernotifications" element={<UserNotifications />} />
              <Route path="/userdocs" element={<UserDocs />} />
              <Route path="/userprofile" element={<UserProfile />} />
              <Route path="/accountmanager" element={<AccountManager />} />
              <Route path="/termsconditions" element={<TermsConditions />} />
              {/* Catch-all: redirect any other path to overview when logged in */}
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </>
        ) : (
          <>
            <MainHeader />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/features" element={<AppFeatures />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/login" element={<Login onLogin={() => setIsAuthenticated(true)} />} />
              <Route path="/getstarted" element={<GetStarted />} />
              {/* Catch-all: redirect any other path to home when logged out */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </>
        )}
      </Router>
=======
      <PageHeader />
      <Dashboard />
>>>>>>> Stashed changes
    </>
  )
}

export default App;