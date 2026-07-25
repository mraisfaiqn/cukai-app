import { useState, useEffect } from 'react';
import ManageProfile from './ManageProfile';
import { getPersonalDetails, updateProfile, getAllEntities, createEntity, updateEntity, deleteEntity, getTaxProfileSummary, getChildren, createChild, updateChild, deleteChild, deleteUser } from '../../services/api';
import { currentFilingYear } from '../../data/formB';

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
    // Opening carry-forward balances (Phase 3) — seed values for the
    // multi-year business-loss (B5/M1) and capital-allowance (M2) engine in
    // carryforward.py; see models.py's Entity docstring.
    openingUnabsorbedBusinessLossMyr:     e.openingUnabsorbedBusinessLossMyr     != null ? String(e.openingUnabsorbedBusinessLossMyr)     : '',
    openingUnabsorbedCapitalAllowanceMyr: e.openingUnabsorbedCapitalAllowanceMyr != null ? String(e.openingUnabsorbedCapitalAllowanceMyr) : '',
    openingBalanceYear:                   e.openingBalanceYear                  != null ? String(e.openingBalanceYear)                    : '',
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
    openingUnabsorbedBusinessLossMyr:     e.openingUnabsorbedBusinessLossMyr     !== '' ? parseFloat(e.openingUnabsorbedBusinessLossMyr)     ?? null : null,
    openingUnabsorbedCapitalAllowanceMyr: e.openingUnabsorbedCapitalAllowanceMyr !== '' ? parseFloat(e.openingUnabsorbedCapitalAllowanceMyr) ?? null : null,
    openingBalanceYear:                   e.openingBalanceYear                  !== '' ? parseInt(e.openingBalanceYear, 10)                  || null : null,
  };
}

function ManageAccount() {
  const [profileData, setProfileData] = useState(null);
  const [entityData,  setEntityData]  = useState([]);
  const [childrenData, setChildrenData] = useState([]);
  const [loadError,   setLoadError]   = useState(null);

  // Active entity is stored in localStorage so Overview and document pages can scope their data
  const [activeEntityId, setActiveEntityId] = useState(
    () => parseInt(localStorage.getItem('activeEntityId') || '0') || null
  );

  // Document-derived tax profile summary for the Generate Forms panel. Unlike
  // Overview.jsx's entity-scoped summary, Form B is a PERSONAL return and must
  // aggregate every business the person owns — passing entityId=null here
  // (rather than activeEntityId) gets the all-entities aggregate from the same
  // backend endpoint. Previously this was scoped to activeEntityId, which
  // silently excluded every OTHER business a multi-entity user owns from B1
  // and the rest of Part B — a real correctness bug, not just a display gap.
  // No longer needs to re-fetch when the active entity changes, since the
  // aggregate doesn't depend on which entity is "active" in the UI — only on
  // the year and the logged-in user.
  const [taxSummary, setTaxSummary] = useState(null);
  const [taxSummaryLoading, setTaxSummaryLoading] = useState(true);

  // Bug fix (14 Jul 2026): this used to be an inline effect that only ever
  // ran once on mount — meaning the Generate Forms panel showed STALE data
  // after any edit that affects the tax computation (adding/removing a
  // child, saving the personal profile, saving/creating/deleting an
  // entity), and only refreshed if the user navigated away and back
  // (remounting the component re-runs the mount effect). Extracted into its
  // own function so every mutating handler below can call it directly after
  // a successful save, instead of only ever running once.
  const refetchTaxSummary = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) {
      setTaxSummaryLoading(false);
      return;
    }
    setTaxSummaryLoading(true);
    try {
      const data = await getTaxProfileSummary(currentFilingYear(), userId, null);
      setTaxSummary(data);
    } catch (err) {
      console.error('Error fetching tax profile summary:', err);
      setTaxSummary(null);
    } finally {
      setTaxSummaryLoading(false);
    }
  };

  useEffect(() => {
    refetchTaxSummary();
  }, []);

  useEffect(() => {
    const load = async () => {
      const userId = localStorage.getItem('userId');
      if (!userId) return;

      // Fetch personal details — its own independent try/catch (Ticket 6,
      // 23 Jul 2026 fix). Previously this call sat directly inside the same
      // outer try as the entities/children fetches below: a throw here (a
      // network blip, a stale/mismatched userId, a transient 500) jumped
      // straight to the outer catch and skipped the entities fetch
      // ENTIRELY — even though the entities fetch already had its own inner
      // try/catch that would have handled its own failure just fine on its
      // own. Now a failure here only affects the profile form fields
      // (loadError banner) and can never take the other fetches down with it.
      try {
        const data = await getPersonalDetails(userId);

        if (data) {
          setProfileData({
            fullName:                     data.fullName                     || '',
            identificationNo:             data.identificationNo             || '',
            passportNo:                   data.passportNo                   || '',
            personalTin:                  data.personalTin                  || '',
            citizenship:                  data.citizenship                  || 'MYS',
            gender:                       data.gender                       || 'male',
            dateOfBirth:                  data.dateOfBirth                  || '',
            maritalStatus:                data.maritalStatus                || 'single',
            maritalEventDate:             data.maritalEventDate             || '',
            spouseName:                   data.spouseName                   || '',
            spouseIdNo:                   data.spouseIdNo                   || '',
            spousePassportNo:             data.spousePassportNo             || '',
            spouseDob:                    data.spouseDob                    || '',
            assessmentType:               data.assessmentType               || 'separate',
            numberOfChildren:             String(data.numberOfChildren      || 0),
            isDisabledSelf:               data.isDisabledSelf               || false,
            spouseIsDisabled:             data.spouseIsDisabled             || false,
            alimonyPaidMyr:               data.alimonyPaidMyr               != null ? String(data.alimonyPaidMyr) : '',
            spouseTotalIncomeMyr:         data.spouseTotalIncomeMyr         != null ? String(data.spouseTotalIncomeMyr) : '',
            passportNoLhdnm:              data.passportNoLhdnm              || '',
            phone:                        data.phone                        || '',
            email:                        data.email                        || '',
            correspondenceAddress:        data.correspondenceAddress        || '',
            correspondencePostcode:       data.correspondencePostcode       || '',
            correspondenceCity:           data.correspondenceCity           || '',
            correspondenceState:          data.correspondenceState          || '',
            refundMethod:                 data.refundMethod                 || 'bank',
            bankName:                     data.bankName                     || '',
            bankAccountNo:                data.bankAccountNo                || '',
            duitnowIdType:                data.duitnowIdType                || 'ic',
            employerTin:                  data.employerTin                  || '',
            taxBorneByEmployer:           data.taxBorneByEmployer           || false,
            carriesOnEcommerce:           data.carriesOnEcommerce           || false,
            ecommerceModel:               data.ecommerceModel               || '',
            recordKeeping:                data.recordKeeping                ?? true,
            hasForeignAccounts:           data.hasForeignAccounts           || false,
            rpgtDisposal:                 data.rpgtDisposal                 || false,
            disposalDeclared:             data.disposalDeclared             || false,
            hasDependentParents:          data.hasDependentParents          || false,
            hasEpfLifeInsurance:          data.hasEpfLifeInsurance          || false,
            hasEducationMedicalInsurance: data.hasEducationMedicalInsurance || false,
            hasLifestylePurchases:        data.hasLifestylePurchases        || false,
            hasSspnEvOther:               data.hasSspnEvOther               || false,
          });
        }
      } catch (err) {
        console.error('Error loading account data:', err);
        setLoadError('Could not load your profile. Please refresh and try again.');
      }

      // Fetch all entities (multi-entity support) — independent of whether
      // the personal-details fetch above succeeded or failed.
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

      // Fetch children records (Phase 3 — H16 relief tiering) — likewise
      // independent of the two fetches above.
      try {
        const children = await getChildren(userId);
        if (children) setChildrenData(children);
      } catch (childErr) {
        console.warn('Could not load children records:', childErr);
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
          identificationNo:             updatedProfile.identificationNo,
          passportNo:                   updatedProfile.passportNo,
          personalTin:                  updatedProfile.personalTin,
          citizenship:                  updatedProfile.citizenship,
          gender:                       updatedProfile.gender,
          dateOfBirth:                  updatedProfile.dateOfBirth       || null,
          maritalStatus:                updatedProfile.maritalStatus,
          maritalEventDate:             updatedProfile.maritalEventDate  || null,
          spouseName:                   updatedProfile.spouseName,
          spouseIdNo:                   updatedProfile.spouseIdNo,
          spousePassportNo:             updatedProfile.spousePassportNo,
          spouseDob:                    updatedProfile.spouseDob         || null,
          assessmentType:               updatedProfile.assessmentType,
          numberOfChildren:             parseInt(updatedProfile.numberOfChildren || 0),
          isDisabledSelf:               updatedProfile.isDisabledSelf,
          spouseIsDisabled:             updatedProfile.spouseIsDisabled,
          alimonyPaidMyr:               updatedProfile.alimonyPaidMyr !== '' ? parseFloat(updatedProfile.alimonyPaidMyr) || null : null,
          spouseTotalIncomeMyr:         updatedProfile.spouseTotalIncomeMyr !== '' ? parseFloat(updatedProfile.spouseTotalIncomeMyr) || null : null,
          passportNoLhdnm:              updatedProfile.passportNoLhdnm,
          phone:                        updatedProfile.phone,
          correspondenceAddress:        updatedProfile.correspondenceAddress,
          correspondencePostcode:       updatedProfile.correspondencePostcode,
          correspondenceCity:           updatedProfile.correspondenceCity,
          correspondenceState:          updatedProfile.correspondenceState,
          refundMethod:                 updatedProfile.refundMethod,
          bankName:                     updatedProfile.bankName,
          bankAccountNo:                updatedProfile.bankAccountNo,
          duitnowIdType:                updatedProfile.duitnowIdType,
          employerTin:                  updatedProfile.employerTin,
          taxBorneByEmployer:           updatedProfile.taxBorneByEmployer,
          carriesOnEcommerce:           updatedProfile.carriesOnEcommerce,
          ecommerceModel:               updatedProfile.ecommerceModel,
          recordKeeping:                updatedProfile.recordKeeping,
          hasForeignAccounts:           updatedProfile.hasForeignAccounts,
          rpgtDisposal:                 updatedProfile.rpgtDisposal,
          disposalDeclared:             updatedProfile.disposalDeclared,
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
        // Bug fix (14 Jul 2026): profile changes (disability, marital status,
        // alimony, spouse income, etc.) all affect the tax computation —
        // refresh so the Generate Forms panel reflects them immediately
        // instead of only after navigating away and back.
        refetchTaxSummary();
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
        refetchTaxSummary(); // new entity's income/opening balances affect the aggregate
        return newEntity;
      }
      return false;
    } catch (err) {
      console.error('Error creating entity:', err);
      // The backend rejects a name/SSM number that already exists on this
      // profile with 409 — surface that exact message so the user knows why,
      // instead of the generic "please try again" fallback.
      if (err.response?.status === 409) {
        return { error: err.response.data?.detail || 'Business already created under this profile.' };
      }
      return false;
    }
  };

  /** PUT edits to an existing entity and update local state on success. */
  const handleSaveEntity = async (updatedEntity) => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) return false;
      const saved = await updateEntity(updatedEntity.id, userId, remapEntityToApi(updatedEntity));
      if (saved) {
        const remapped = remapEntityFromApi(saved);
        setEntityData((prev) => prev.map((e) => e.id === remapped.id ? remapped : e));
        refetchTaxSummary(); // opening balances / financial figures affect the aggregate
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
      const userId = localStorage.getItem('userId');
      if (!userId) return false;
      const res = await deleteEntity(entityId, userId);
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
        refetchTaxSummary(); // removing an entity's documents/assets affects the aggregate
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error deleting entity:', err);
      return false;
    }
  };

  /**
   * Permanently delete the logged-in user's account and everything linked
   * to it (documents, entities, chat history, insights, etc. — see the
   * backend's /userDelete endpoint for the full scope). Triggered from the
   * Danger Zone at the bottom of the Personal Profile panel.
   *
   * On success: clears every localStorage key PageHeader's own logout
   * clears, then does a HARD reload to '/' rather than a client-side
   * navigate(). A plain navigate('/') + onLogout() raced against
   * ProtectedLayout/PublicLayout's own isAuthenticated guards (both
   * re-check on every render) — confirmed via testing that even batching
   * the two calls together, the browser could still end up bounced to
   * /overview and then /login before '/' ever settled. A hard reload
   * sidesteps that class of bug entirely: the whole app boots fresh at
   * '/', with isAuthenticated computed straight from the (already-cleared)
   * localStorage on the very first render — there's no in-between render
   * for either guard to misfire on. sessionStorage (not React Router
   * state, which doesn't survive a hard reload) carries the goodbye flag
   * for Home.jsx to pick up.
   */
  const handleDeleteAccount = async () => {
    const userId = localStorage.getItem('userId');
    if (!userId) return false;
    try {
      await deleteUser(userId);

      localStorage.removeItem('userId');
      localStorage.removeItem('userFullName');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('activeEntityId');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('cukaiActiveSessionId:')) localStorage.removeItem(key);
      }

      sessionStorage.setItem('cukaiAccountDeleted', '1');
      window.location.href = '/';
      return true;
    } catch (err) {
      console.error('Error deleting account:', err);
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

  /** POST a new child record and update local state on success. */
  const handleCreateChild = async (draft) => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) return false;
      const created = await createChild(userId, draft);
      if (created) {
        setChildrenData((prev) => [...prev, created]);
        refetchTaxSummary(); // H16 relief depends on child records — refresh immediately
        return created;
      }
      return false;
    } catch (err) {
      console.error('Error creating child record:', err);
      return false;
    }
  };

  /** PUT edits to an existing child record and update local state on success. */
  const handleSaveChild = async (childId, draft) => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) return false;
      const saved = await updateChild(childId, userId, draft);
      if (saved) {
        setChildrenData((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
        refetchTaxSummary(); // H16 tiering (age/study/disability) may have changed
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error saving child record:', err);
      return false;
    }
  };

  /** DELETE a child record on the backend and remove it from local state on success. */
  const handleDeleteChild = async (childId) => {
    try {
      const userId = localStorage.getItem('userId');
      if (!userId) return false;
      const res = await deleteChild(childId, userId);
      if (res && res.deleted) {
        setChildrenData((prev) => prev.filter((c) => c.id !== childId));
        refetchTaxSummary(); // removed child's H16 contribution must disappear immediately
        return true;
      }
      return false;
    } catch (err) {
      console.error('Error deleting child record:', err);
      return false;
    }
  };

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Manage Account</h1>
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
            taxSummary={taxSummary}
            taxSummaryLoading={taxSummaryLoading}
            initialChildren={childrenData}
            onCreateChild={handleCreateChild}
            onSaveChild={handleSaveChild}
            onDeleteChild={handleDeleteChild}
            onDeleteAccount={handleDeleteAccount}
          />
        </div>
      </div>
    </main>
  );
}

export default ManageAccount;