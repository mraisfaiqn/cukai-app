import { Routes, Route, Navigate } from 'react-router-dom';
import UserNavigation from '../../components/UserNavigation';
import ProfileTab from './ProfileTab';
import ManagePermission from './ManagePermissions';
import LanguageDisplayTab from './LanguageDisplay';
import PersonalDetailsTab from './PersonalDetailsTab';

function ManageAccount() {
  return (
    <main className="min-h-screen bg-background font-body">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      
        {/* Account Settings Header Banner */}
        <div>
          <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">Account Settings</h1>
          <p className="text-sm text-[#64748B] mt-1.5">
            Manage your business entities, team members, and interface preferences.
          </p>
        </div>

        {/* Mounting the horizontal tab navigation links layout */}
        <UserNavigation />

        {/* Internal Sub-View Router Mechanism Viewport */}
        <div className="w-full pt-2">
          <Routes>
          {/* Automatically land users on the Personal Profile view now */}
              <Route index element={<Navigate to="personal" replace />} />

              <Route path="personal" element={<PersonalDetailsTab />} />
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