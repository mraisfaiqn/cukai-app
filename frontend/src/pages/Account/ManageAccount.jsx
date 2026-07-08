import { useState, useEffect } from 'react';
import ManageProfile from './ManageProfile';
import { getPersonalDetails, updateProfile, getAllEntities, createEntity, updateEntity, deleteEntity } from '../../services/api';

/**
 * Remap a backend Entity record to the shape ManageProfile expects.
 * The backend returns flat keys (address/city/state); the UI uses premiseX variants.
 */
function remapEntityFromApi(e) {
  return {
    id:               e.id,
    entityType:       e.entityType       || 'sole-prop',
    name:             e.name             || '',
    businessCode:     e.businessCode     || '',
    businessActivity: e.businessActivity || '',
    ssmNo:            e.ssmNo            || '',
    tin:              e.tin              || '',
    premiseAddress:   e.address          || '',
    premisePostcode:  e.postcode         || '',
    premiseCity:      e.city             || '',
    premiseState:     e.state            || '',
    salesTurnover:    e.salesTurnover    != null ? String(e.salesTurnover)    : '',
    totalExpenditure: e.totalExpenditure != null ? String(e.totalExpenditure) : '',
    netProfitLoss:    e.netProfitLoss    != null ? String(e.netProfitLoss)    : '',
    totalAssets:      e.totalAssets      != null ? String(e.totalAssets)      : '',
    totalLiabilities: e.totalLiabilities != null ? String(e.totalLiabilities) : '',
  };
}

/**
 * Remap a ManageProfile entity draft back to the backend's flat key shape
 * before sending it to POST /entities or PUT /entities/:id.
 */
function remapEntityToApi(e) {
  return {
    entityType:       e.entityType,
    name:             e.name,
    businessCode:     e.businessCode,
    businessActivity: e.businessActivity,
    ssmNo:            e.ssmNo,
    tin:              e.tin,
    address:          e.premiseAddress   || '',
    postcode:         e.premisePostcode  || '',
    city:             e.premiseCity      || '',
    state:            e.premiseState     || '',
    salesTurnover:    parseFloat(e.salesTurnover)    || null,
    totalExpenditure: parseFloat(e.totalExpenditure) || null,
    netProfitLoss:    parseFloat(e.netProfitLoss)    || null,
    totalAssets:      parseFloat(e.totalAssets)      || null,
    totalLiabilities: parseFloat(e.totalLiabilities) || null,
  };
}

function ManageAccount() {
  const [profileData, setProfileData] = useState(null);
  const [entityData,  setEntityData]  = useState([]);
  const [loadError,   setLoadError]   = useState(null);

  // Active entity is stored in localStorage so Overview and document pages can scope their data
  const [activeEntityId, setActiveEntityId] = useState(
    () => parseInt(localStorage.getItem('activeEntityId') || '0') || null
  );

  useEffect(() => {
    const load = async () => {
      try {
        const userId = localStorage.getItem('userId');
        if (!userId) return;

        // Fetch personal details
        const data = await getPersonalDetails(userId);

        if (data) {
          setProfileData({
            fullName:                     data.fullName                     || '',
            idType:                       data.idType                       || 'ic',
            identificationNo:             data.identificationNo             || '',
            personalTin:                  data.personalTin                  || '',
            citizenship:                  data.citizenship                  || 'MYS',
            gender:                       data.gender                       || 'male',
            dateOfBirth:                  data.dateOfBirth                  || '',
            maritalStatus:                data.maritalStatus                || 'single',
            maritalEventDate:             data.maritalEventDate             || '',
            spouseName:                   data.spouseName                   || '',
            spouseIdNo:                   data.spouseIdNo                   || '',
            spouseDob:                    data.spouseDob                    || '',
            assessmentType:               data.assessmentType               || 'separate',
            numberOfChildren:             String(data.numberOfChildren      || 0),
            hasDisabledDependents:        data.hasDisabledDependents        || false,
            phone:                        data.phone                        || '',
            email:                        data.email                        || '',
            correspondenceAddress:        data.correspondenceAddress        || '',
            correspondencePostcode:       data.correspondencePostcode       || '',
            correspondenceCity:           data.correspondenceCity           || '',
            correspondenceState:          data.correspondenceState          || '',
            refundMethod:                 data.refundMethod                 || 'bank',
            bankName:                     data.bankName                     || '',
            bankAccountNo:                data.bankAccountNo                || '',
            recordKeeping:                data.recordKeeping                ?? true,
            hasForeignAccounts:           data.hasForeignAccounts           || false,
            rpgtDisposal:                 data.rpgtDisposal                 || false,
            hasDependentParents:          data.hasDependentParents          || false,
            hasEpfLifeInsurance:          data.hasEpfLifeInsurance          || false,
            hasEducationMedicalInsurance: data.hasEducationMedicalInsurance || false,
            hasLifestylePurchases:        data.hasLifestylePurchases        || false,
            hasSspnEvOther:               data.hasSspnEvOther               || false,
          });
        }

        // Fetch all entities (multi-entity support)
        try {
          const entities = await getAllEntities(userId);
          if (entities) {
            const mapped = entities.map(remapEntityFromApi);
            setEntityData(mapped);

            // Validate the stored activeEntityId actually belongs to THIS user's
            // entities. If it doesn't — e.g. it's a leftover from a different
            // account that logged in earlier in this browser — fall back to the
            // first entity instead of silently pointing at someone else's data.
            const stored = parseInt(localStorage.getItem('activeEntityId') || '0');
            const storedBelongsToUser = mapped.some((ent) => ent.id === stored);

            if ((!stored || !storedBelongsToUser) && mapped.length > 0) {
              localStorage.setItem('activeEntityId', String(mapped[0].id));
              setActiveEntityId(mapped[0].id);
            } else if (storedBelongsToUser) {
              setActiveEntityId(stored);
            }
          }
        } catch (entityErr) {
          console.warn('Could not load entities:', entityErr);
        }

      } catch (err) {
        console.error('Error loading account data:', err);
        setLoadError('Could not load your profile. Please refresh and try again.');
      }
    };

    load();
  }, []);

  /** Persist personal profile edits via PUT /userProfile/:id. */
  const handleSavePersonal = async (updatedProfile) => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) return false;

      const res = await updateProfile(userId, {
          fullName:                     updatedProfile.fullName,
          idType:                       updatedProfile.idType,
          identificationNo:             updatedProfile.identificationNo,
          personalTin:                  updatedProfile.personalTin,
          citizenship:                  updatedProfile.citizenship,
          gender:                       updatedProfile.gender,
          dateOfBirth:                  updatedProfile.dateOfBirth       || null,
          maritalStatus:                updatedProfile.maritalStatus,
          maritalEventDate:             updatedProfile.maritalEventDate  || null,
          spouseName:                   updatedProfile.spouseName,
          spouseIdNo:                   updatedProfile.spouseIdNo,
          spouseDob:                    updatedProfile.spouseDob         || null,
          assessmentType:               updatedProfile.assessmentType,
          numberOfChildren:             parseInt(updatedProfile.numberOfChildren || 0),
          hasDisabledDependents:        updatedProfile.hasDisabledDependents,
          phone:                        updatedProfile.phone,
          correspondenceAddress:        updatedProfile.correspondenceAddress,
          correspondencePostcode:       updatedProfile.correspondencePostcode,
          correspondenceCity:           updatedProfile.correspondenceCity,
          correspondenceState:          updatedProfile.correspondenceState,
          refundMethod:                 updatedProfile.refundMethod,
          bankName:                     updatedProfile.bankName,
          bankAccountNo:                updatedProfile.bankAccountNo,
          recordKeeping:                updatedProfile.recordKeeping,
          hasForeignAccounts:           updatedProfile.hasForeignAccounts,
          rpgtDisposal:                 updatedProfile.rpgtDisposal,
          hasDependentParents:          updatedProfile.hasDependentParents,
          hasEpfLifeInsurance:          updatedProfile.hasEpfLifeInsurance,
          hasEducationMedicalInsurance: updatedProfile.hasEducationMedicalInsurance,
          hasLifestylePurchases:        updatedProfile.hasLifestylePurchases,
          hasSspnEvOther:               updatedProfile.hasSspnEvOther,
      });

      if (res) {
        const saved = res;
        setProfileData(updatedProfile);
        // Keep fullName in localStorage fresh for Permissions "You" row
        localStorage.setItem('userFullName', saved.fullName || updatedProfile.fullName);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error saving personal profile:', err);
      return false;
    }
  };

  /** POST a new entity under the current user and update local state on success. */
  const handleCreateEntity = async (draft) => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) return false;

      const created = await createEntity(userId, remapEntityToApi(draft));
      if (created) {
        const newEntity = remapEntityFromApi(created);
        setEntityData((prev) => [...prev, newEntity]);
        return newEntity;
      }
      return false;
    } catch (err) {
      console.error('Error creating entity:', err);
      return false;
    }
  };

  /** PUT edits to an existing entity and update local state on success. */
  const handleSaveEntity = async (updatedEntity) => {
    try {
      const saved = await updateEntity(updatedEntity.id, remapEntityToApi(updatedEntity));
      if (saved) {
        const remapped = remapEntityFromApi(saved);
        setEntityData((prev) => prev.map((e) => e.id === remapped.id ? remapped : e));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error saving entity:', err);
      return false;
    }
  };

  /** DELETE an entity on the backend and remove it from local state on success. */
  const handleDeleteEntity = async (entityId) => {
    try {
      const res = await deleteEntity(entityId);
      if (res && res.deleted) {
        const remaining = entityData.filter((e) => e.id !== entityId);
        setEntityData(remaining);

        // If the deleted entity was the active one, fall back to whatever's left
        const stored = parseInt(localStorage.getItem('activeEntityId') || '0');
        if (stored === entityId && remaining.length > 0) {
          localStorage.setItem('activeEntityId', String(remaining[0].id));
          setActiveEntityId(remaining[0].id);
          window.dispatchEvent(new CustomEvent('entitySwitch', { detail: { entityId: remaining[0].id } }));
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error deleting entity:', err);
      return false;
    }
  };

  /**
   * Persist the active entity selection and notify all mounted pages to
   * re-fetch their entity-scoped data via a custom browser event.
   */
  const handleSwitchEntity = (entityId) => {
    localStorage.setItem('activeEntityId', String(entityId));
    setActiveEntityId(entityId);
    window.dispatchEvent(new CustomEvent('entitySwitch', { detail: { entityId } }));
  };

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Account Settings</h1>
          <p className="text-xs text-muted mt-1">Manage your personal details and business entities.</p>
        </div>

        {loadError && (
          <div className="p-3 bg-red-50 border border-red-100 text-critical rounded-xl text-xs font-medium">
            ⚠️ {loadError}
          </div>
        )}

        <div className="flex-1 min-h-0">
          <ManageProfile
            initialProfile={profileData}
            initialEntities={entityData}
            activeEntityId={activeEntityId}
            onSavePersonal={handleSavePersonal}
            onCreateEntity={handleCreateEntity}
            onSaveEntity={handleSaveEntity}
            onDeleteEntity={handleDeleteEntity}
            onSwitchEntity={handleSwitchEntity}
          />
        </div>
      </div>
    </main>
  );
}

export default ManageAccount;