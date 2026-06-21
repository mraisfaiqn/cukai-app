import { Routes, Route, Navigate } from 'react-router-dom';
import UserNavigation from '../../components/UserNavigation';
import ManageProfile from './ManageProfile';
import ManagePermission from './ManagePermissions';

function ManageAccount() {
  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        {/* Header */}
        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Account Settings</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Manage your business entities, team members, and interface preferences.
          </p>
        </div>

        {/* Tab nav */}
        <div className="shrink-0">
          <UserNavigation />
        </div>

        {/* Tab content — no scroll, fills remaining height */}
        <div className="flex-1 min-h-0">
          <Routes>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ManageProfile />} />
            <Route path="permissions" element={<ManagePermission />} />
          </Routes>
        </div>

      </div>
    </main>
  );
}

export default ManageAccount;