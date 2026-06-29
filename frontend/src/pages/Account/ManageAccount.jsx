import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import UserNavigation from '../../components/UserNavigation';
import ManageProfile from './ManageProfile';
import ManagePermission from './ManagePermissions';

function ManageAccount() {
  const [profileData, setProfileData] = useState(null);
  const [entityData, setEntityData] = useState([]); // 1. Add state for the entities list

  useEffect(() => {
    const loadProfileFromDatabase = async () => {
      try {
        const userId = localStorage.getItem("userId");
        if (!userId) return;

        // Fetch personal details
        const response = await fetch(`http://localhost:8000/personalDetails/${userId}`);
        const data = await response.json();

        // 2. Fetch company details right here!
        const companyRes = await fetch(`http://localhost:8000/companyDetails/${userId}`);
        const companyData = await companyRes.json();

        if (data) {
          setProfileData({
            fullName: data.fullName || "",
            idType: data.idType || "ic",
            identificationNo: data.identificationNo || "",
            personalTin: data.personalTin || "",
            citizenship: data.citizenship || "MYS",
            gender: data.gender || "male",
            dateOfBirth: data.dateOfBirth || "",
            maritalStatus: data.maritalStatus || "single",
            maritalEventDate: data.maritalEventDate || "",
            spouseName: data.spouseName || "",
            spouseIdNo: data.spouseIdNo || "",
            spouseDob: data.spouseDob || "",
            assessmentType: data.assessmentType || "separate",
            numberOfChildren: String(data.numberOfChildren || 0),
            hasDisabledDependents: data.hasDisabledDependents || false,
            phone: data.phone || "",
            email: data.email || "",
            correspondenceAddress: data.correspondenceAddress || "",
            correspondencePostcode: data.correspondencePostcode || "",
            correspondenceCity: data.correspondenceCity || "",
            correspondenceState: data.correspondenceState || "",
            refundMethod: data.refundMethod || "bank",
            bankName: data.bankName || "",
            bankAccountNo: data.bankAccountNo || "",
            recordKeeping: data.recordKeeping ?? true,
            hasForeignAccounts: data.hasForeignAccounts || false,
            rpgtDisposal: data.rpgtDisposal || false,
            hasDependentParents: data.hasDependentParents || false,
            hasEpfLifeInsurance: data.hasEpfLifeInsurance || false,
            hasEducationMedicalInsurance: data.hasEducationMedicalInsurance || false,
            hasLifestylePurchases: data.hasLifestylePurchases || false,
            hasSspnEvOther: data.hasSspnEvOther || false,
          });
        }

        // 3. Store the retrieved company object inside your entity array state
        if (companyData) {
          setEntityData([companyData]);
        }
      } catch (err) {
        console.error("Error fetching personal database records:", err);
      }
    };

    loadProfileFromDatabase();
  }, []);

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Account Settings</h1>
          <p className="text-xs text-[#64748B] mt-1">Manage your business entities, team members, and interface preferences.</p>
        </div>

        <div className="shrink-0">
          <UserNavigation />
        </div>

        <div className="flex-1 min-h-0">
          <Routes>
            <Route index element={<Navigate to="profile" replace />} />
            {/* 4. Pass BOTH your loaded profile profile AND your entity list array as props! */}
            <Route path="profile" element={<ManageProfile initialProfile={profileData} initialEntities={entityData} />} />
            <Route path="permissions" element={<ManagePermission />} />
          </Routes>
        </div>

      </div>
    </main>
  );
}

// const handleSavePersonal = async (updatedProfile) => {
//     try {
//       const userId = localStorage.getItem("userId");
//       if (!userId) return false;

//       // Send the updated data bundle over to your backend API
//       const response = await fetch(`http://localhost:8000/personalDetails/${userId}`, {
//         method: "PUT", // or POST depending on your backend route configuration
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify(updatedProfile),
//       });

//       if (response.ok) {
//         // Update local state so changes reflect instantly in your UI components
//         setProfileData(updatedProfile);
//         return true;
//       } else {
//         console.error("Failed to save changes onto backend server status:", response.status);
//         return false;
//       }
//     } catch (err) {
//       console.error("Error connecting to server while saving profiles:", err);
//       return false;
//     }
//   };

//   return (
//     // ... down in your return block, update the Route to forward the save function:
//     <Route 
//       path="profile" 
//       element={
//         <ManageProfile 
//           initialProfile={profileData} 
//           initialEntities={entityData} 
//           onSavePersonal={handleSavePersonal} //  Pass the function down!
//         />
//       } 
//     />
//   )
  
export default ManageAccount;