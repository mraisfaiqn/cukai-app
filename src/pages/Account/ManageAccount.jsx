import { Routes, Route, Navigate } from 'react-router-dom';
import UserNavigation from '../../components/UserNavigation';
import ProfileTab from './ProfileTab';
import ManagePermission from './ManagePermissions';
import LanguageDisplayTab from './LanguageDisplay';

function ManageAccount() {
  return (
    <main className="min-h-screen bg-background font-body text-leeft">
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8 text-left">
      
      {/* Account Settings Header Banner */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#0F172A]">Account Settings</h1>
        <p className="text-sm text-[#64748B] mt-1.5">
          Manage your business entities, team members, and interface preferences.
        </p>
      </div>

      {/* Mounting the horizontal tab navigation links layout */}
      <UserNavigation />

      {/* Internal Sub-View Router Mechanism Viewport */}
      <div className="w-full pt-2">
        <Routes>
          {/* Automatically redirect /manageaccount down to /manageaccount/profile */}
          <Route index element={<Navigate to="profile" replace />} />
          
          {/* Sub-tab view viewport assignments */}
          <Route path="profile" element={<ProfileTab />} />
          <Route path="permissions" element={<ManagePermission />} />
          <Route path="display" element={<LanguageDisplayTab />} />
        </Routes>
      </div>

    </div>
    </main>
  );
}
export default ManageAccount 