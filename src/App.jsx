import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom'
import MainHeader from './components/MainHeader'
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

// MainHeader is hidden on the landing home page because Home.jsx renders its own
// full-featured landing nav (with section anchors, language switcher, etc.)
function ConditionalMainHeader() {
  const { pathname } = useLocation()
  if (pathname === '/') return null
  return <MainHeader />
}
// App shell for authenticated pages: renders the PageHeader nav once, and the
// matched child route fills the <Outlet />. Every logged-in page lives inside
// this shell so they all share the same in-app top nav.
function AppShell() {
  return (
    <>
      <PageHeader />
      <Outlet />
    </>
  )
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  return (
    <>
      <Router>
        {isAuthenticated ? (
            <Routes>
            {/* Every logged-in page shares the PageHeader shell via this layout route. */}
            <Route element={<AppShell />}>
              <Route path="/overview" element={<Dashboard />} />
              {/* ":id" is a dynamic segment, read on the page via useParams. */}
              <Route path="/opportunities/:id" element={<OpportunityDetail />} />
              <Route path="/vault" element={<CukaiVault />} />
              <Route path="/cukaibot" element={<CukaiBot />} />
              <Route path="/insightsinbox" element={<InsightsInbox />} />
              <Route path="/userdocs" element={<UserDocs />} />
              <Route path="/manageaccount/*" element={<ManageAccount />} />
              <Route path="/termsconditions" element={<TermsConditions />} />
              {/* Catch-all: redirect any other path to overview when logged in */}
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Route>
            </Routes>
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