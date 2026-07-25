import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { getAllEntities, getChatSessions, searchChatSessions, getChatHistory, sendChatMessage, deleteChatSession, updateChatSession, getChatFolders, renameChatFolder, deleteChatFolder, uploadChatAttachment, deleteChatAttachment } from '../services/api';
import cukaiBot from '../assets/cukaibot-icon.png';
// import { jsPDF } from 'jspdf';

// Mirrors backend MAX_CHAT_ATTACHMENTS_PER_MESSAGE (main.py) — kept in sync
// manually since there's no shared-constants layer between the two; only
// used here to stop offering the file picker once the composer is full,
// the backend is still the source of truth that actually enforces it.
const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 5;

// ── Icons ────────────────────────────────────────────────────────────────────

const BotIcon = ({ className = 'h-5 w-5' }) => (
  <img src={cukaiBot} alt="CukaiBot" className={className} />
);

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const AttachIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const BookIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

// Used instead of ExternalLinkIcon for citations of a user's own uploaded
// document (isInternal:true) — signals "preview here" rather than "leaves
// the page", since these open an in-page modal, not a new tab.
const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SparkleIcon = ({ className = 'h-4 w-4 text-primary' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const FileTextIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

// Sidebar-toggle icon: a rectangle with a vertical divider near the left edge,
// the same "panel" glyph most chat apps (including Claude's own sidebar
// toggle) use — familiar enough that it doesn't need a text label next to it.
const PanelLeftIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const PlusIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const MessageSquareIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const SearchIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const XIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// "Kebab" 3-dot menu trigger — same glyph Claude's own sidebar uses to
// reveal per-session actions (pin/rename/folder/delete) without cluttering
// the row with several always-visible icon buttons. `horizontal` lays the
// three dots left-to-right instead of top-to-bottom (a "meatballs" menu),
// which reads more naturally at the end of a single-line chat session row.
const MoreIcon = ({ className = 'h-3.5 w-3.5', horizontal = false }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor">
    {horizontal ? (
      <>
        <circle cx="5" cy="12" r="1.75" />
        <circle cx="12" cy="12" r="1.75" />
        <circle cx="19" cy="12" r="1.75" />
      </>
    ) : (
      <>
        <circle cx="12" cy="5" r="1.75" />
        <circle cx="12" cy="12" r="1.75" />
        <circle cx="12" cy="19" r="1.75" />
      </>
    )}
  </svg>
);

const PinIcon = ({ className = 'h-3.5 w-3.5', filled = false }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h.5a1 1 0 0 0 0-2h-8a1 1 0 0 0 0 2H8v4.76Z" />
  </svg>
);

const PencilIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

const FolderIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </svg>
);

const FolderPlusIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);

const CheckIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronRightIcon = ({ className = 'h-3.5 w-3.5' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ── Topic icons for the empty-state suggestion grid ─────────────────────────
// Small, single-purpose glyphs so each starter prompt gets a recognizable
// visual anchor instead of four identical pill shapes.
const WifiIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5a11 11 0 0 1 14 0" />
    <path d="M8.3 15.9a6.5 6.5 0 0 1 7.4 0" />
    <path d="M11.6 19.2a2 2 0 0 1 .8-.2c.3 0 .6.07.8.2" />
    <circle cx="12" cy="19.6" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const PercentIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="5" x2="5" y2="19" />
    <circle cx="6.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
  </svg>
);

const ReceiptIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="9" y1="12" x2="15" y2="12" />
  </svg>
);

const HeartPulseIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.8 8.6c0-2.6-2.1-4.6-4.6-4.6-1.6 0-3 .8-3.9 2-.9-1.2-2.3-2-3.9-2-2.5 0-4.6 2-4.6 4.6 0 4.4 5.4 8.2 8.5 10.9 3.1-2.7 8.5-6.5 8.5-10.9Z" />
    <polyline points="7 12 9.5 12 10.5 9.5 12.5 14.5 13.5 12 17 12" />
  </svg>
);

// ── Mock conversation data ───────────────────────────────────────────────────
// No longer wired up — kept as reference/fallback. The real conversation now
// comes from GET /api/chat/{session_id}/history via getChatHistory() in the
// component below, backed by ChatSession/ChatMessage in Postgres.

const suggestedPrompts = [
  {
    prompt: 'Can I claim broadband as a business expense?',
    label: 'Broadband as a business expense',
    icon: WifiIcon,
  },
  {
    prompt: 'What is the Section 33 deduction limit?',
    label: 'Section 33 deduction limit',
    icon: PercentIcon,
  },
  {
    prompt: 'Explain the 2025 e-invoicing phases.',
    label: '2025 e-invoicing phases',
    icon: ReceiptIcon,
  },
  {
    prompt: 'How do I claim medical relief for my parents?',
    label: 'Medical relief for parents',
    icon: HeartPulseIcon,
  },
];

const MOCK_MESSAGES_BY_ENTITY = {
  // Seed conversation for the demo "Meridian Print Studio" entity (id 1 in
  // the mock entity set used elsewhere in the app). Any other entity ID
  // falls through to an empty conversation / welcome state.
  1: [
    {
      id: 1,
      role: 'user',
      text: 'What are the rules and limits for claiming medical expenses for my parents this year?',
    },
    {
      id: 2,
      role: 'assistant',
      text: "You can claim a tax relief for medical treatment, special needs, and carer expenses for your parents. Here is the breakdown for the current assessment year:",
      structured: {
        highlight: { label: 'MAXIMUM CLAIMABLE AMOUNT', value: 'RM8,000', note: 'This relief is granted under Section 46(1)(c) of the Income Tax Act (ITA) 1967.' },
        checkItems: [
          { bold: 'Eligible Expenses:', text: 'Medical care and treatment provided by a nursing home, and non-cosmetic dental treatment.' },
          { bold: 'Condition:', text: 'The medical condition must be certified by a qualified medical practitioner.' },
          { bold: 'Documentation:', text: 'Original receipts and a medical report must be retained for audit purposes.' },
        ],
      },
      citations: [
        { tag: 'ITA 1967', title: 'Section 46(1)(c)', snippet: '"medical treatment, special needs or carer expenses expended in that basis year by that individual for his..."', verified: 'Verified against 2024 Gazette' },
        { tag: 'PUBLIC RULING', title: 'PR No. 11/2021', snippet: 'Guidelines on the deduction for expenses in relation to medical treatment for parents.' },
      ],
    },
  ],
};

/** Mirrors what a real per-entity chat history fetch would resolve to. */
function getInitialMessagesForEntity(entityId) {
  return MOCK_MESSAGES_BY_ENTITY[entityId] || [];
}

// ── Sidebar helpers ──────────────────────────────────────────────────────────

/**
 * Buckets sessions into groups for the sidebar, in this order:
 *   1. "Pinned" — pinned sessions that are NOT filed in a folder, newest
 *      first. A pinned session that's also in a folder stays inside that
 *      folder instead (see below) — it just shows a small pin badge on its
 *      row (see SessionRow) rather than being lifted out into this group.
 *      Only once a pinned session loses its folder (folder deleted, or
 *      explicitly moved out) does it fall into this group, since at that
 *      point "pinned" is the only organizing fact left about it.
 *   2. One group per folder the user has created, alphabetically. Each
 *      folder group contains ALL of that folder's sessions — pinned and
 *      unpinned alike — so pinning a session never moves it out of the
 *      folder it's filed under. Within a folder, pinned sessions float to
 *      the top (see sortFolderItems below) so pinning one moves it there
 *      immediately, without needing a refresh to pick up the server's own
 *      pinned-first ordering.
 *   3. The same "Today / Yesterday / Previous 7 Days / Older" recency
 *      buckets Claude's sidebar uses, for whatever's left (no folder, not
 *      pinned) — based on each session's updatedAt so a session you just
 *      replied in jumps back to "Today" rather than staying pinned to when
 *      it was first created.
 * Sessions arrive pre-sorted most-recent-first from getChatSessions() (with
 * pinned-and-unfiled already sorted first server-side too), and that order
 * is preserved within each bucket.
 */
function groupSessionsByRecency(sessions) {
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const today = startOfDay(new Date());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

  // Folder membership takes priority over pinned status for *placement*:
  // a pinned session with a folder stays grouped under that folder. Only
  // pinned sessions with no folder go into the top-level "Pinned" group.
  // Sorted newest-pinned-first by pinnedAt (see sortFolderItems below for
  // why this can't be updatedAt) so pinning/unpinning re-sorts this group
  // instantly from local state too, not just within-folder pinned items.
  const pinnedUnfiled = sessions
    .filter((s) => s.pinned && !s.folder)
    .sort((a, b) => new Date(b.pinnedAt ?? b.updatedAt) - new Date(a.pinnedAt ?? a.updatedAt));
  const foldered = sessions.filter((s) => s.folder);
  const unfiledUnpinned = sessions.filter((s) => !s.folder && !s.pinned);

  // Within a folder, pinned sessions float to the top (newest-pinned
  // first), then the rest keep the incoming most-recent-first order. This
  // is done here — rather than relying on sessions already arriving
  // pre-sorted from the server — so toggling pin on a session re-sorts its
  // folder instantly from local state, without waiting on a refetch.
  //
  // Sorted by pinnedAt, NOT updatedAt: pinnedAt is a dedicated "when was
  // this pinned" timestamp (see handlePinSession / the backend's
  // ChatSession.pinned_at) that's independent of conversation activity.
  // Using updatedAt here used to cause a real bug — pinning or unpinning a
  // session bumps its updatedAt as a side effect of the PATCH request, so
  // sorting pinned-group order by updatedAt meant the *act* of pinning
  // could reorder other already-pinned sessions, and an unpinned session's
  // bumped updatedAt could outrank its folder-mates once the server-side
  // list was refetched — even though nothing about the conversation itself
  // had changed. Falling back to updatedAt only covers sessions pinned
  // before pinnedAt existed server-side.
  const sortFolderItems = (items) => {
    const pinnedItems = items.filter((s) => s.pinned).sort((a, b) => new Date(b.pinnedAt ?? b.updatedAt) - new Date(a.pinnedAt ?? a.updatedAt));
    const unpinnedItems = items.filter((s) => !s.pinned);
    return [...pinnedItems, ...unpinnedItems];
  };

  const folderNames = [...new Set(foldered.map((s) => s.folder))].sort();
  const folderGroups = folderNames.map((name) => ({
    label: name,
    isFolder: true,
    items: sortFolderItems(foldered.filter((s) => s.folder === name)),
  }));

  const recencyGroups = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ];
  for (const s of unfiledUnpinned) {
    const updated = startOfDay(s.updatedAt);
    if (updated.getTime() === today.getTime()) recencyGroups[0].items.push(s);
    else if (updated.getTime() === yesterday.getTime()) recencyGroups[1].items.push(s);
    else if (updated > weekAgo) recencyGroups[2].items.push(s);
    else recencyGroups[3].items.push(s);
  }

  const groups = [
    ...(pinnedUnfiled.length > 0 ? [{ label: 'Pinned', groupKey: '__pinned__', isPinned: true, items: pinnedUnfiled }] : []),
    ...folderGroups.map((g) => ({ ...g, groupKey: `folder:${g.label}` })),
    ...recencyGroups.map((g) => ({ ...g, groupKey: `recency:${g.label}` })),
  ];
  return groups.filter((g) => g.items.length > 0);
}

// ── Last-active-session persistence ──────────────────────────────────────
// Remembers which chat session was open, per entity, so navigating away to
// another page and back resumes the same conversation instead of resetting
// to the empty/welcome state — mirrors how localStorage('activeEntityId')
// already persists the active entity across visits. Scoped per entity
// (rather than one global key) because each entity has its own independent
// conversation history — see ChatSession.entity_id and the surrounding
// effects that reload messages when activeEntity changes.
//
// Deliberately NOT read as a fallback inside the `?session=` URL-param
// effect below when the person has explicitly started a new chat: "New
// chat" (handleNewChat) and "Clear Chat" (handleClear) both call
// clearPersistedSessionId so a fresh/cleared conversation stays fresh next
// time this page loads, rather than silently resurrecting the old session.
function _sessionStorageKey(entityId) {
  return `cukaiActiveSessionId:${entityId ?? 'none'}`;
}
function getPersistedSessionId(entityId) {
  return localStorage.getItem(_sessionStorageKey(entityId));
}
function setPersistedSessionId(entityId, sessionId) {
  localStorage.setItem(_sessionStorageKey(entityId), sessionId);
}
function clearPersistedSessionId(entityId) {
  localStorage.removeItem(_sessionStorageKey(entityId));
}

// ── Sub-components ───────────────────────────────────────────────────────────

/**
 * Renders markdown text (bold, bullet lists, paragraphs) using the same
 * typographic scale the plain <p> tags used before, so switching this in
 * doesn't change the overall look — it just stops showing raw "**"/"##"/"- "
 * characters to the user. The backend's CHAT_SYSTEM_PROMPT now asks Gemini
 * for lightly-formatted prose rather than heavy markdown structure (see
 * main.py), so this only needs to handle a handful of element types.
 */
function MarkdownText({ text, className = '' }) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-headings">{children}</strong>,
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          // Headings collapse to bold inline text rather than large heading
          // sizes — CHAT_SYSTEM_PROMPT discourages "###" now, but this keeps
          // any that slip through from blowing up the chat bubble's layout.
          h1: ({ children }) => <p className="mb-2 font-semibold text-headings last:mb-0">{children}</p>,
          h2: ({ children }) => <p className="mb-2 font-semibold text-headings last:mb-0">{children}</p>,
          h3: ({ children }) => <p className="mb-2 font-semibold text-headings last:mb-0">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CitationCard({ citation, onPreview }) {
  // Collapsed by default — extraExcerpts (when present) are additional
  // page-text from the SAME document that also matched the question (see
  // main.py's _chunks_to_citations: one card per reference_no, with the
  // runner-up chunks folded in here rather than rendered as their own
  // duplicate-looking cards). Local, not lifted to parent state, since
  // each card's expand/collapse is independent and doesn't need to survive
  // a re-render of the citations list (switching messages naturally
  // remounts this component with a fresh collapsed state, which is the
  // right default for a citation you haven't looked at yet).
  const [showExtraExcerpts, setShowExtraExcerpts] = useState(false);

  // No click-based "did it work?" detection here on purpose. window.open()
  // with 'noopener' set gives no trustworthy signal either way: some
  // browsers return null even on a successful open (noopener deliberately
  // drops the reference back), and there's no way to observe whether a
  // cross-origin destination actually loaded or 404'd from this page.
  // A previous version tried to infer failure from the return value and
  // ended up flagging perfectly working links as broken. Instead, the
  // fallback index link (when available) is just always shown as a small
  // secondary option — accurate in every case, since it doesn't depend on
  // guessing.
  //
  // isInternal citations (a user's own uploaded document, served from this
  // backend's own /files/ mount — see main.py's _chunks_to_citations) skip
  // all of that: there's no cross-origin uncertainty and no link rot to
  // guard against, so these just open the in-page preview modal instead.
  const handleOpenSource = () => {
    if (citation.isInternal) {
      onPreview?.(citation);
      return;
    }
    window.open(citation.sourceUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center rounded-full bg-headings px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          {citation.tag}
        </span>
        {citation.sourceUrl && (
          <button
            className="text-muted transition-colors hover:text-primary"
            onClick={handleOpenSource}
            title={citation.isInternal ? 'Preview document' : (citation.pageNumber ? `Open source document (page ${citation.pageNumber})` : 'Open source document')}
          >
            {citation.isInternal ? <EyeIcon /> : <ExternalLinkIcon />}
          </button>
        )}
      </div>
      <p className="text-sm font-semibold text-headings">{citation.title}</p>
      {citation.pageNumber && (
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Page {citation.pageNumber}</p>
      )}
      <p className="mt-1.5 break-words font-mono text-xs leading-relaxed text-muted">{citation.snippet}</p>
      {citation.extraExcerptCount > 0 && (
        <div className="mt-1">
          <button
            className="text-[10px] font-medium text-primary underline decoration-dotted underline-offset-2"
            onClick={() => setShowExtraExcerpts((v) => !v)}
          >
            {showExtraExcerpts
              ? 'Hide extra excerpt' + (citation.extraExcerptCount > 1 ? 's' : '')
              : `+${citation.extraExcerptCount} more excerpt${citation.extraExcerptCount > 1 ? 's' : ''} from this source`}
          </button>
          {showExtraExcerpts && (
            <div className="mt-2 space-y-2 border-l-2 border-border pl-2.5">
              {(citation.extraExcerpts || []).map((excerpt, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between gap-2">
                    {excerpt.pageNumber ? (
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Page {excerpt.pageNumber}</p>
                    ) : (
                      <span />
                    )}
                    {excerpt.sourceUrl && (
                      <button
                        className="text-muted transition-colors hover:text-primary"
                        onClick={() => window.open(excerpt.sourceUrl, '_blank', 'noopener,noreferrer')}
                        title={excerpt.pageNumber ? `Open source document (page ${excerpt.pageNumber})` : 'Open source document'}
                      >
                        <ExternalLinkIcon />
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 break-words font-mono text-xs leading-relaxed text-muted">{excerpt.snippet}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {citation.verified && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5">
          <CheckCircleIcon />
          <span className="text-xs font-medium text-primary">{citation.verified}</span>
        </div>
      )}
      {citation.fallbackUrl && (
        <div className="mt-2.5 border-t border-border pt-2.5">
          <p className="text-[11px] text-muted">
            {citation.sourceUrl ? 'Link not opening?' : 'Direct link unavailable —'}{' '}
            <button
              className="text-primary underline"
              onClick={() => window.open(citation.fallbackUrl, '_blank', 'noopener,noreferrer')}
            >
              search {citation.fallbackLabel || 'the official source index'} instead.
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Document Preview modal (for CitationCard's isInternal citations) ────────
// A lighter-weight cousin of CukaiAccount.jsx's DocumentPreview slide-over:
// same embed/img rendering approach and the same "prefix a relative /files/
// path with the API base URL" trick, but read-only — no reclassify/archive/
// delete footer, since this is opened from a chat citation, not the document
// manager. citation.sourceUrl is already the relative path main.py's
// _chunks_to_citations put on the chunk (see pipeline.py's
// embed_document_for_rag), so no Postgres lookback is needed here at all.
// A single attached-file chip. Two modes, switched on whether `onRemove` is
// passed:
//  - Composer (pending, not yet sent): shows a remove ('x') button, no
//    click-to-preview yet since the file has no server-side sourceUrl
//    while still status:'uploading' or freshly uploaded-but-unsent.
//  - Sent message (inside a UserMessage bubble): clickable to open
//    DocumentPreviewModal, same as a citation — see onPreview.
function AttachmentChip({ attachment, onRemove, onPreview }) {
  const isImage = attachment.fileType === 'image';
  const isUploading = attachment.status === 'uploading';
  const isFailed = attachment.status === 'failed';

  const content = (
    <>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${isFailed ? 'bg-red-100 text-red-500' : 'bg-primary-tint text-primary'}`}>
        {isImage ? <ImageIcon className="h-3.5 w-3.5" /> : <FileTextIcon />}
      </span>
      <span className="min-w-0 max-w-[140px] truncate text-[11px] font-medium text-headings">
        {attachment.title || attachment.name}
      </span>
      {isUploading && (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      )}
    </>
  );

  const baseClasses = "flex items-center gap-1.5 rounded-lg border border-border bg-slate-50 py-1 pl-1.5 pr-2 shadow-sm";

  if (onRemove) {
    return (
      <div className={baseClasses}>
        {content}
        <button
          type="button"
          onClick={onRemove}
          title="Remove attachment"
          className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted hover:bg-slate-200 hover:text-headings transition-colors"
        >
          <XIcon className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPreview}
      title={`Preview ${attachment.title}`}
      className={`${baseClasses} hover:bg-slate-100 transition-colors text-left`}
    >
      {content}
    </button>
  );
}

// Shown above the input (and inside the sent message bubble) whenever the
// conversation is grounded in an insight card — any of relief_headroom's
// "How to claim these", provision's "Plan year-end moves", or digest's
// "Ask CukaiBot about this" deep-links (see InsightsInbox.jsx's runAction).
// Deliberately styled with the same amber/"ai-highlight" tokens
// InsightsInbox.jsx's own AiChip/digest badge already use, rather than
// AttachmentChip's neutral slate, so it reads immediately as "this reply is
// grounded in an insight card", not "a file is attached" — the two are
// visually distinct at a glance.
function InsightContextChip({ meta, onRemove }) {
  const content = (
    <>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-ai-highlight text-warning">
        <SparkleIcon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 max-w-[200px] truncate text-[11px] font-medium text-headings">
        {meta.label}
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-ai-highlight py-1 pl-1.5 pr-2 shadow-sm">
      {content}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove insight context"
          className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-warning/70 hover:bg-warning/10 hover:text-warning transition-colors"
        >
          <XIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

const ImageIcon = ({ className = 'h-4 w-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

function DocumentPreviewModal({ citation, onClose }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const fileUrl = citation.sourceUrl ? `${API_URL}${citation.sourceUrl}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl transition-all duration-300 ease-out ${visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-headings truncate">{citation.title}</p>
            {citation.tag && <p className="text-[10px] text-muted mt-0.5">{citation.tag}</p>}
          </div>
          <button onClick={handleClose} className="text-[#94A3B8] hover:text-headings transition-colors shrink-0 ml-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* File preview area */}
        <div className="flex-1 min-h-0 overflow-auto bg-[#E8EBEF]">
          {!fileUrl ? (
            <div className="flex h-full items-center justify-center text-center p-8">
              <p className="text-xs text-[#94A3B8]">File preview not available.</p>
            </div>
          ) : citation.fileType === 'image' ? (
            <div className="flex h-full items-center justify-center p-4">
              <img
                src={fileUrl}
                alt={citation.title}
                className="max-h-full max-w-full object-contain rounded-lg shadow-xl border border-border"
                onError={e => { e.target.style.display = 'none'; }}
              />
            </div>
          ) : citation.fileType === 'excel' ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <svg className="mx-auto mb-3 h-12 w-12 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                </svg>
                <p className="text-xs font-medium text-headings">{citation.title}</p>
                <p className="text-[10px] text-muted mt-1">Spreadsheet files cannot be previewed in-browser.</p>
                <a href={fileUrl} download
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover transition-colors duration-150">
                  <DownloadIcon />
                  Download to view
                </a>
              </div>
            </div>
          ) : (
            // Default to PDF rendering — file_type is "pdf" for the vast
            // majority of uploaded receipts/invoices (DOCUMENT_EXTENSIONS is
            // PDF-only, see pipeline.py), and an <embed> here degrades
            // gracefully to a browser download prompt if it somehow isn't.
            <embed src={fileUrl} type="application/pdf" className="w-full h-full" title={citation.title} />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyCitationsPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-slate-50/50 p-6 text-center">
      <FileTextIcon className="mb-2 h-8 w-8 text-slate-300" />
      <p className="mt-2 text-xs text-muted">Ask more questions to generate relevant citations.</p>
    </div>
  );
}

function AssistantMessage({ message, isActive, onSelectCitations, showFollowups = false, onSelectFollowup }) {
  const citationCount = message.citations?.length || 0;
  const followups = showFollowups ? (message.followups || []).slice(0, 3) : [];
  return (
    <div className="flex gap-4">
      {/* Bot avatar */}
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-primary-tint text-primary">
        <BotIcon className="h-6 w-6 object-contain" />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <button
          type="button"
          onClick={() => onSelectCitations?.(message)}
          title={citationCount ? 'View this reply\'s sources' : undefined}
          className={`block w-[calc(100%+0.75rem)] select-text rounded-xl px-3 py-2 -ml-3 text-left transition-colors ${
            isActive ? 'bg-primary-tint/60 ring-1 ring-primary/30' : 'hover:bg-slate-50'
          }`}
        >
          <MarkdownText text={message.text} className="select-text text-xs leading-relaxed text-[#334155]" />
          {citationCount > 0 && (
            <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted">
              <FileTextIcon className="h-3 w-3" />
              {citationCount} source{citationCount === 1 ? '' : 's'}
            </span>
          )}
        </button>

        {message.structured && (
          <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
            {/* Highlight block */}
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-2 mb-1">
                <SparkleIcon />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  {message.structured.highlight.label}
                </span>
              </div>
              <p className="font-headings text-xl font-bold tracking-tight text-headings">{message.structured.highlight.value}</p>
              <p className="mt-1 text-xs text-muted">{message.structured.highlight.note}</p>
            </div>

            {/* Check items */}
            <div className="divide-y divide-slate-50 px-5 py-2">
              {message.structured.checkItems.map((item, i) => (
                <div key={i} className="flex items-start gap-3 py-3">
                  <CheckCircleIcon />
                  <p className="text-xs text-[#334155]">
                    <span className="font-semibold text-headings">{item.bold} </span>
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggested follow-ups — inline, part of the scrolling message flow
            (not a fixed panel below it, which used to permanently shrink the
            conversation viewport on every screen — see the screenshot that
            prompted this change). Only the latest assistant reply ever shows
            these (showFollowups, set by the parent from lastAssistantMessageId),
            and clicking one dismisses this block for THIS message via
            onSelectFollowup — the next reply gets its own fresh set instead
            of two messages both showing chips at once. */}
        {followups.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <SparkleIcon className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                Suggested follow-ups
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {followups.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onSelectFollowup?.(prompt)}
                  className="group flex w-full items-center gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2 text-left text-xs font-medium text-[#334155] transition-colors hover:border-primary hover:bg-primary-tint hover:text-primary"
                >
                  <span className="flex-1 min-w-0">{prompt}</span>
                  <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message, isActive, onSelectCitations, onPreviewAttachment }) {
  const attachments = message.attachments || [];
  return (
    <div className="flex flex-col items-end gap-1.5">
      {message.insightContext && (
        <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
          <InsightContextChip meta={message.insightContext} />
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
          {attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} onPreview={() => onPreviewAttachment?.(a)} />
          ))}
        </div>
      )}
      {message.text && (
        <button
          type="button"
          onClick={() => onSelectCitations?.(message)}
          title="View sources for this question's reply"
          className={`max-w-[75%] select-text rounded-2xl rounded-tr-sm border px-4 py-3 text-left shadow-sm transition-colors ${
            isActive
              ? 'border-primary/40 bg-primary-tint ring-2 ring-primary/50'
              : 'border-border bg-surface hover:bg-slate-50'
          }`}
        >
          <span className="select-text block text-xs leading-relaxed text-headings">{message.text}</span>
        </button>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-primary-tint text-primary">
        <BotIcon className="h-6 w-6 object-contain" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 shadow-sm">
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '150ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-primary" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// ── Chat history sidebar ─────────────────────────────────────────────────────
// Claude-style collapsible left sidebar: lists this entity's chat sessions
// (from Postgres via getChatSessions), grouped by recency, with a "new chat"
// action and a per-row delete. Collapses to a slim icon rail rather than
// disappearing entirely, so the toggle stays reachable — mirrors how
// Claude's own sidebar collapse behaves.

function ChatHistorySidebar({
  isOpen, onToggle, sessions, isLoading, isLoadingMore, hasMore, onLoadMore, activeSessionId, onSelectSession, onNewChat, onDeleteSession,
  onPinSession, onRenameSession, onAddToFolder, onRemoveFromFolder, onRenameFolder, onDeleteFolder, folders,
  searchQuery, onSearchQueryChange, searchResults, searchLoading, isSearchActive,
}) {
  const grouped = groupSessionsByRecency(sessions);

  // Which folder groups are collapsed — keyed by groupKey (e.g.
  // "folder:Client A"), persisted so a folder someone collapsed stays
  // collapsed across reloads instead of re-expanding every visit. Only
  // folder groups are collapsible (Pinned and the recency buckets stay
  // always-expanded, same as Claude's own sidebar), so this only ever
  // needs to track keys starting with "folder:".
  const [collapsedFolders, setCollapsedFolders] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('cukaiCollapsedFolders') || '[]'));
    } catch (_) {
      return new Set();
    }
  });

  function toggleFolderCollapsed(groupKey) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      localStorage.setItem('cukaiCollapsedFolders', JSON.stringify([...next]));
      return next;
    });
  }

  // Fires onLoadMore once the list is scrolled within ~80px of its bottom —
  // the same "near the end" threshold pattern most infinite-scroll lists
  // use, so the next page starts fetching a little before the user actually
  // hits the hard bottom edge rather than after, keeping the scroll feeling
  // continuous instead of pausing on a visible edge each time. Only relevant
  // to the normal paginated list — search results aren't paginated, so this
  // is a no-op (onLoadMore isn't called) while a search is active.
  function handleScroll(e) {
    if (isSearchActive) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 80) {
      onLoadMore?.();
    }
  }

  // Collapsed rail: just the toggle and a "new chat" icon button, both still
  // reachable with one click — collapsing shouldn't strand the user.
  if (!isOpen) {
    return (
      <div className="hidden lg:flex w-14 shrink-0 h-full flex-col items-center gap-2 rounded-2xl border border-border bg-surface py-3 shadow-sm">
        <button
          onClick={onToggle}
          title="Show chat history"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-50 hover:text-headings"
        >
          <PanelLeftIcon />
        </button>
        <button
          onClick={onNewChat}
          title="New chat"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-50 hover:text-headings"
        >
          <PlusIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="hidden lg:flex lg:flex-col w-64 shrink-0 h-full min-h-0 rounded-2xl border border-border bg-surface shadow-sm overflow-hidden">
      {/* Header: title + collapse toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3 shrink-0">
        <span className="text-sm font-bold text-headings">Chat history</span>
        <button
          onClick={onToggle}
          title="Hide chat history"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-50 hover:text-headings"
        >
          <PanelLeftIcon className="h-4 w-4" />
        </button>
      </div>

      {/* New chat button */}
      <div className="px-3 pt-3 shrink-0">
        <button
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-headings shadow-sm transition-colors hover:bg-slate-50"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New chat
        </button>
      </div>

      {/* Search box — matches both session titles and message content (see
          searchChatSessions), since titles alone are short AI-generated
          summaries that won't capture a specific figure or vendor name. */}
      <div className="px-3 pt-2.5 shrink-0">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-slate-50/50 px-2.5 py-2 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Search chats…"
            className="min-w-0 flex-1 bg-transparent text-xs text-headings placeholder-[#94A3B8] outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchQueryChange('')}
              title="Clear search"
              className="shrink-0 rounded-md p-0.5 text-slate-300 transition-colors hover:text-headings"
            >
              <XIcon />
            </button>
          )}
        </div>
      </div>

      {/* Session list — only the current page (20 most recent, then 20 more
          per scroll-triggered fetch) is ever in `sessions`, never the user's
          full chat history at once. While a search is active, this renders
          `searchResults` instead (a single ranked list, not paginated). */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-3 space-y-4" onScroll={handleScroll}>
        {isSearchActive ? (
          searchLoading && searchResults.length === 0 ? (
            <p className="px-2 text-xs text-muted">Searching…</p>
          ) : searchResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
              <SearchIcon className="h-6 w-6 text-slate-300" />
              <p className="text-xs text-muted">No conversations match "{searchQuery.trim()}".</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map((s) => (
                <SessionRow
                  key={s.sessionId}
                  session={s}
                  isActive={s.sessionId === activeSessionId}
                  onSelectSession={onSelectSession}
                  onDeleteSession={onDeleteSession}
                  onPinSession={onPinSession}
                  onRenameSession={onRenameSession}
                  onAddToFolder={onAddToFolder}
                  onRemoveFromFolder={onRemoveFromFolder}
                  folders={folders}
                  matchedIn={s.matchedIn}
                  snippet={s.snippet}
                />
              ))}
            </div>
          )
        ) : isLoading ? (
          <p className="px-2 text-xs text-muted">Loading…</p>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <MessageSquareIcon className="h-6 w-6 text-slate-300" />
            <p className="text-xs text-muted">No conversations yet. Ask a question to start one.</p>
          </div>
        ) : (
          <>
            {grouped.map((group) => {
              const isCollapsible = group.isFolder;
              const isCollapsed = isCollapsible && collapsedFolders.has(group.groupKey);
              return (
                <div key={group.groupKey}>
                  {isCollapsible ? (
                    <FolderGroupHeader
                      name={group.label}
                      count={group.items.length}
                      isCollapsed={isCollapsed}
                      onToggleCollapsed={() => toggleFolderCollapsed(group.groupKey)}
                      onRenameFolder={(newName) => onRenameFolder(group.label, newName)}
                      onDeleteFolder={() => onDeleteFolder(group.label)}
                    />
                  ) : (
                    <p className="flex items-center gap-1 px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                      {group.isPinned && <PinIcon filled className="h-2.5 w-2.5" />}
                      {group.label}
                    </p>
                  )}
                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {group.items.map((s) => (
                        <SessionRow
                          key={s.sessionId}
                          session={s}
                          isActive={s.sessionId === activeSessionId}
                          onSelectSession={onSelectSession}
                          onDeleteSession={onDeleteSession}
                          onPinSession={onPinSession}
                          onRenameSession={onRenameSession}
                          onAddToFolder={onAddToFolder}
                          onRemoveFromFolder={onRemoveFromFolder}
                          folders={folders}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Bottom-of-list state: either a small spinner row while the
                next page is being fetched, or (once hasMore is false) an
                "end of history" marker so it's clear scrolling further
                won't reveal anything — rather than looking like it's
                just silently stuck. */}
            {isLoadingMore ? (
              <p className="px-2 pt-1 text-center text-[10px] text-muted">Loading more…</p>
            ) : !hasMore ? (
              <p className="px-2 pt-1 text-center text-[10px] text-slate-300">No more conversations</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A folder's group header in the sidebar — the collapse/expand chevron and
 * folder name, plus a small 3-dot menu of its own for Rename folder /
 * Delete folder. Renaming here is a group-level action (it bulk-renames the
 * folder tag on every session filed under it — see renameChatFolder), which
 * is why it lives on the header rather than in each session's own menu.
 */
function FolderGroupHeader({ name, count, isCollapsed, onToggleCollapsed, onRenameFolder, onDeleteFolder }) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuButtonRef = useRef(null);
  const menuRef = useRef(null);
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) { setMenuOpen(false); setConfirmingDelete(false); }
    }
    function handleKey(e) { if (e.key === 'Escape') { setMenuOpen(false); setConfirmingDelete(false); } }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  function openMenu(e) {
    e.stopPropagation();
    setAnchorRect(menuButtonRef.current.getBoundingClientRect());
    setMenuOpen(true);
  }

  function startRename() {
    setRenameValue(name);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (trimmed && trimmed !== name) onRenameFolder(trimmed);
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5 rounded-md px-2 py-1 bg-slate-50">
        <FolderIcon className="h-2.5 w-2.5 shrink-0 text-muted" />
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="min-w-0 flex-1 rounded border border-primary bg-surface px-1 py-0.5 text-[11px] text-headings outline-none"
        />
        <button onClick={commitRename} title="Save" className="shrink-0 rounded p-0.5 text-primary hover:bg-primary-tint">
          <CheckIcon className="h-3 w-3" />
        </button>
        <button onClick={() => setRenaming(false)} title="Cancel" className="shrink-0 rounded p-0.5 text-slate-300 hover:text-headings">
          <XIcon className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="group/folder flex items-center gap-1 rounded-md px-2 pb-1 pt-0.5">
      <button
        onClick={onToggleCollapsed}
        className="flex min-w-0 flex-1 items-center gap-1 text-left text-[10px] font-bold uppercase tracking-wider text-muted transition-colors hover:text-headings"
      >
        <ChevronRightIcon className={`h-2.5 w-2.5 shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
        <FolderIcon className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">{name}</span>
        <span className="shrink-0 text-[9px] font-semibold text-slate-300">{count}</span>
      </button>
      <button
        ref={menuButtonRef}
        onClick={openMenu}
        title="Folder options"
        className={`shrink-0 rounded p-0.5 text-slate-300 transition-all hover:bg-slate-200 hover:text-headings ${
          menuOpen ? 'opacity-100 bg-slate-200' : 'opacity-0 group-hover/folder:opacity-100'
        }`}
      >
        <MoreIcon className="h-3 w-3" />
      </button>
      {menuOpen && anchorRect && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: Math.min(anchorRect.right - 160, window.innerWidth - 168),
            top: anchorRect.bottom + 4,
            width: 160,
          }}
          className="z-50 rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          <button
            onClick={() => { startRename(); setMenuOpen(false); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-headings transition-colors hover:bg-slate-50"
          >
            <PencilIcon className="h-3.5 w-3.5 text-muted" />
            Rename folder
          </button>
          {!confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-critical transition-colors hover:bg-critical-bg"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Delete folder
            </button>
          ) : (
            <div className="px-3 py-2">
              <p className="mb-1.5 text-[11px] text-muted">Delete folder? Chats stay, just un-filed.</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => { onDeleteFolder(); setMenuOpen(false); }}
                  className="flex-1 rounded-md bg-critical px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-critical/90"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The sidebar's per-session 3-dot ("kebab") menu — Pin/Unpin, Rename, Add to
 * folder (with a submenu of existing folders plus "New folder…"), and
 * Delete. Mirrors Claude's own sidebar session menu. Rendered via a fixed
 * overlay positioned under the trigger button rather than a plain
 * `absolute` dropdown, so it isn't clipped by the sidebar's own
 * `overflow-y-auto` session list.
 */
function SessionMenu({
  session: s, onClose, anchorRect, onPin, onRename, onAddToFolder, onRemoveFromFolder, onDelete, folders,
}) {
  // Folder flyout opens on hover (mouse enter) and stays open while the
  // pointer is anywhere over either the trigger row or the flyout itself —
  // same behavior as a native app's nested menu, so the folder list appears
  // immediately instead of needing an extra click first. A short close
  // delay (rather than closing the instant the pointer leaves) keeps the
  // flyout from vanishing during the brief gap while moving the mouse from
  // the trigger row over to the flyout panel itself.
  const [showFolderFlyout, setShowFolderFlyout] = useState(false);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuRef = useRef(null);
  const folderTriggerRef = useRef(null);
  const closeFlyoutTimer = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    }
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useEffect(() => () => clearTimeout(closeFlyoutTimer.current), []);

  function openFlyoutNow() {
    clearTimeout(closeFlyoutTimer.current);
    setShowFolderFlyout(true);
  }
  function closeFlyoutSoon() {
    // While the "New folder" name input is showing, the mouse leaving the
    // panel just means the person moved their cursor to type or click
    // elsewhere on the screen — it doesn't mean they're done with the
    // flyout. Closing it out from under them here would silently discard
    // whatever they were about to create, so once that input is open the
    // flyout only closes via Cancel/Create, Escape, or clicking outside the
    // whole menu (handled by SessionMenu's own document click listener).
    if (showNewFolderInput) return;
    clearTimeout(closeFlyoutTimer.current);
    closeFlyoutTimer.current = setTimeout(() => {
      setShowFolderFlyout(false);
      setShowNewFolderInput(false);
      setNewFolderName('');
    }, 150);
  }

  // Position just under the trigger button, right-aligned to it — flips to
  // open upward instead if there isn't enough room below (e.g. the last row
  // in a long list), same as most sidebar kebab menus.
  const MENU_WIDTH = 208;
  const MENU_EST_HEIGHT = 216;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUpward = spaceBelow < MENU_EST_HEIGHT && anchorRect.top > MENU_EST_HEIGHT;
  const style = {
    position: 'fixed',
    left: Math.min(anchorRect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    top: openUpward ? undefined : anchorRect.bottom + 4,
    bottom: openUpward ? window.innerHeight - anchorRect.top + 4 : undefined,
    width: MENU_WIDTH,
  };

  // The flyout panel opens to the RIGHT of the main menu by default (the
  // sidebar itself sits on the left edge of the screen, so there's normally
  // plenty of room there) — only flips to the left if the main menu is
  // pushed far enough right that a right-side flyout would run off-screen.
  const flyoutStyle = (() => {
    const rightEdgeIfOpenRight = anchorRect.right + 4 + MENU_WIDTH;
    const openRight = rightEdgeIfOpenRight <= window.innerWidth - 8;
    return {
      position: 'fixed',
      top: style.top,
      bottom: style.bottom,
      left: openRight
        ? anchorRect.right + 4
        : Math.max(8, anchorRect.right - MENU_WIDTH - MENU_WIDTH - 4),
      width: MENU_WIDTH,
    };
  })();

  function submitNewFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    onAddToFolder(name);
    onClose();
  }

  return (
    <div
      ref={menuRef}
      style={style}
      // This menu is rendered as a DOM descendant of the session row it
      // belongs to (so it can sit inside the row's hover/group styling),
      // even though it's visually a fixed-position overlay elsewhere on
      // screen. Without stopping propagation here, every click inside it —
      // Pin, Rename, a folder in the "Move to folder" flyout, Delete,
      // Cancel, anything — would bubble up to the row's own onClick and
      // switch the active conversation to whichever session this menu
      // happens to belong to, even when opened from a session other than
      // the one currently open. Stopping it here keeps the current session
      // selected no matter which menu action is chosen.
      onClick={(e) => e.stopPropagation()}
      className="z-50 rounded-xl border border-border bg-surface py-1 shadow-lg"
    >
      <button
        onClick={() => { onPin(!s.pinned); onClose(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-headings transition-colors hover:bg-slate-50"
      >
        <PinIcon filled={s.pinned} className="h-3.5 w-3.5 text-muted" />
        {s.pinned ? 'Unpin' : 'Pin'}
      </button>
      <button
        onClick={() => { onRename(); onClose(); }}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-headings transition-colors hover:bg-slate-50"
      >
        <PencilIcon className="h-3.5 w-3.5 text-muted" />
        Rename
      </button>

      {/* Add/Move to folder — hovering this row opens the folder flyout
          immediately (no click needed); clicking or keyboard-focusing it
          also opens it, so it stays reachable without a mouse. */}
      <div
        ref={folderTriggerRef}
        onMouseEnter={openFlyoutNow}
        onMouseLeave={closeFlyoutSoon}
        className="relative"
      >
        <button
          onClick={openFlyoutNow}
          onFocus={openFlyoutNow}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-headings transition-colors hover:bg-slate-50 ${
            showFolderFlyout ? 'bg-slate-50' : ''
          }`}
        >
          <FolderPlusIcon className="h-3.5 w-3.5 text-muted" />
          <span className="flex-1">{s.folder ? 'Move to folder' : 'Add to folder'}</span>
          <ChevronRightIcon className="h-3 w-3 text-slate-300" />
        </button>

        {showFolderFlyout && (
          <div
            onMouseEnter={openFlyoutNow}
            onMouseLeave={closeFlyoutSoon}
            style={flyoutStyle}
            className="z-50 rounded-xl border border-border bg-surface py-1 shadow-lg"
          >
            {!showNewFolderInput ? (
              <>
                <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">Folders</p>
                <div className="max-h-40 overflow-y-auto">
                  {folders.length === 0 && (
                    <p className="px-3 py-1.5 text-[11px] text-muted">No folders yet.</p>
                  )}
                  {folders.map((f) => (
                    <button
                      key={f}
                      onClick={() => { onAddToFolder(f); onClose(); }}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs font-medium transition-colors hover:bg-slate-50 ${
                        s.folder === f ? 'text-primary' : 'text-headings'
                      }`}
                    >
                      <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="flex-1 truncate">{f}</span>
                      {s.folder === f && <CheckIcon className="h-3 w-3 shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => setShowNewFolderInput(true)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-primary-tint"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  New folder
                </button>
              </>
            ) : (
              <div className="p-2">
                <input
                  autoFocus
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitNewFolder(); }}
                  placeholder="Folder name"
                  className="mb-1.5 w-full rounded-md border border-border px-2 py-1.5 text-xs text-headings outline-none focus:border-primary"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={submitNewFolder}
                    disabled={!newFolderName.trim()}
                    className="flex-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => { setShowNewFolderInput(false); setNewFolderName(''); }}
                    className="flex-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {s.folder && (
        <button
          onClick={() => { onRemoveFromFolder(); onClose(); }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-headings transition-colors hover:bg-slate-50"
        >
          <FolderIcon className="h-3.5 w-3.5 text-muted" />
          Remove from folder
        </button>
      )}
      <div className="my-1 border-t border-border" />
      {!confirmingDelete ? (
        <button
          onClick={() => setConfirmingDelete(true)}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-critical transition-colors hover:bg-critical-bg"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          Delete
        </button>
      ) : (
        <div className="px-3 py-2">
          <p className="mb-1.5 text-[11px] text-muted">Delete this conversation?</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => { onDelete(); onClose(); }}
              className="flex-1 rounded-md bg-critical px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-critical/90"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="flex-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Single row in the sidebar's session list — shared between the normal
 * recency-grouped list and search results, so the two only differ in what's
 * shown below the title: search results additionally show a "Title"/"Message"
 * badge and a matched snippet (from searchChatSessions' matchedIn/snippet),
 * while the normal list just shows the relative timestamp.
 *
 * The trash icon that used to always sit at the row's right edge is now a
 * 3-dot menu trigger (see SessionMenu) offering Pin/Unpin, Rename, Add to
 * folder, and Delete — the same customization set Claude's own sidebar
 * exposes per-conversation.
 */
function SessionRow({
  session: s, isActive, onSelectSession, onDeleteSession, onPinSession, onRenameSession,
  onAddToFolder, onRemoveFromFolder, folders, matchedIn, snippet,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(s.title || '');
  const menuButtonRef = useRef(null);
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  function openMenu(e) {
    e.stopPropagation();
    setAnchorRect(menuButtonRef.current.getBoundingClientRect());
    setMenuOpen(true);
  }

  function startRename() {
    setRenameValue(s.title || '');
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (trimmed && trimmed !== s.title) onRenameSession(s.sessionId, trimmed);
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 bg-slate-50">
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="min-w-0 flex-1 rounded-md border border-primary bg-surface px-1.5 py-1 text-xs text-headings outline-none"
        />
        <button
          onClick={(e) => { e.stopPropagation(); commitRename(); }}
          title="Save"
          className="shrink-0 rounded-md p-1 text-primary transition-colors hover:bg-primary-tint"
        >
          <CheckIcon />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setRenaming(false); }}
          title="Cancel"
          className="shrink-0 rounded-md p-1 text-slate-300 transition-colors hover:text-headings"
        >
          <XIcon />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelectSession(s.sessionId)}
      className={`group flex items-center gap-1 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
        isActive ? 'bg-primary-tint' : 'hover:bg-slate-50'
      }`}
    >
      {s.pinned && <PinIcon filled className="h-3 w-3 shrink-0 text-muted" />}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-xs font-medium ${isActive ? 'text-primary' : 'text-headings'}`}>
          {s.title || 'New conversation'}
        </p>
        {matchedIn && (
          <div className="flex items-center gap-1">
            <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
              {matchedIn === 'title' ? 'Title' : 'Message'}
            </span>
            {matchedIn === 'message' && (
              <p className="truncate text-[10px] text-muted">{snippet}</p>
            )}
          </div>
        )}
      </div>
      <button
        ref={menuButtonRef}
        onClick={openMenu}
        title="More options"
        className={`shrink-0 rounded-md p-1 text-slate-300 transition-all hover:bg-slate-200 hover:text-headings ${
          menuOpen ? 'opacity-100 bg-slate-200' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <MoreIcon horizontal />
      </button>
      {menuOpen && anchorRect && (
        <SessionMenu
          session={s}
          anchorRect={anchorRect}
          folders={folders}
          onClose={() => setMenuOpen(false)}
          onPin={(pinned) => onPinSession(s.sessionId, pinned)}
          onRename={startRename}
          onAddToFolder={(folder) => onAddToFolder(s.sessionId, folder)}
          onRemoveFromFolder={() => onRemoveFromFolder(s.sessionId)}
          onDelete={() => onDeleteSession(s.sessionId)}
        />
      )}
    </div>
  );
}

/**
 * Chat header's title, editable in place. Click (or focus) the title to swap
 * it for a text input — same commit/cancel behavior as the sidebar's
 * SessionRow rename input (Enter/blur saves, Escape cancels) — so the two
 * renaming entry points feel like the same feature. Falls back to the
 * "Tax Advisory Assistant" placeholder whenever there's no active session
 * yet, and that placeholder isn't itself editable (there's no session to
 * rename until the first message creates one).
 */
function ChatHeaderTitle({ title, sessionId, onRename }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEditing() {
    if (!sessionId) return;
    setValue(title || '');
    setEditing(true);
  }

  function commit() {
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed && trimmed !== title) onRename(sessionId, trimmed);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-full max-w-xs rounded-md border border-primary bg-surface px-1.5 py-0.5 text-sm font-bold text-headings outline-none"
      />
    );
  }

  return (
    <p
      onClick={startEditing}
      title={sessionId ? 'Click to rename' : undefined}
      className={`truncate text-sm font-bold text-headings ${sessionId ? 'cursor-text rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-slate-50' : ''}`}
    >
      {title || 'Tax Advisory Assistant'}
    </p>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

// `embed` (default false) strips the page chrome so this component can be
// iframed inside the browser-extension side panel: no big "Cukai Bot" title
// block, full viewport height (there's no PageHeader above it in embed mode),
// and tighter padding to fit a narrow panel. The chat-history sidebar already
// self-hides below the `lg` breakpoint (see ChatHistorySidebar's `hidden
// lg:flex`), so a ~400px panel shows just the conversation with no extra work.
function CukaiBot({ embed = false }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  // Message IDs whose inline "Suggested follow-ups" the user has already
  // acted on (clicked one of the 3 questions) — see AssistantMessage's
  // followups block. Only ever matters for the LATEST assistant message
  // (older ones never render followups regardless, see the render check
  // below), but tracked as a Set rather than a single id so switching
  // sessions or reloading history can't leave a stale dismissal pointing at
  // the wrong message.
  const [dismissedFollowupIds, setDismissedFollowupIds] = useState(() => new Set());
  const [activeCitations, setActiveCitations] = useState([]);
  // Which assistant message's citations are currently shown in the side
  // panel — lets the UI highlight "you're viewing message X's sources" and
  // gives handleSelectCitations something to compare against. null when no
  // message has been explicitly selected yet (falls back to the newest
  // citation-bearing message, same as the old default behavior).
  const [activeCitationsMessageId, setActiveCitationsMessageId] = useState(null);
  const [activeEntity, setActiveEntity] = useState(null);
  // Which citation's document is currently open in the in-page preview
  // modal (see DocumentPreviewModal below) — null when closed. Only ever
  // set for citations with isInternal:true (a user's own uploaded document
  // served from this backend's /files/ mount); external LHDN links still
  // open in a new tab via CitationCard's existing window.open path.
  const [previewCitation, setPreviewCitation] = useState(null);
  // Files attached to the message currently being composed, not yet sent —
  // each entry starts as {id: <temp>, name, status: 'uploading'} the moment
  // it's picked, then gets patched in place with the real server id/
  // title/sourceUrl/fileType once uploadChatAttachment resolves (see
  // handleFilesPicked), or status:'failed' if the upload errors. Cleared
  // after a successful send (see handleSend) and on handleNewChat.
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const fileInputRef = useRef(null);
  // Backend-issued chat session id — null until the first message is sent
  // (or until an existing session is resolved for this entity), mirroring
  // how a WhatsApp thread gets its ID on its first message.
  const [sessionId, setSessionId] = useState(null);
  // Set from a "?insightId=" URL param (InsightsInbox's "Ask CukaiBot about
  // this" card action — see runAction there) and cleared once the resulting
  // first message is sent. Carried in state rather than re-read from the URL
  // each send, since the param is stripped from the URL as soon as it's
  // consumed (see the mount effect below) so a later refresh doesn't try to
  // re-attach it to an unrelated message.
  const [pendingInsightId, setPendingInsightId] = useState(null);
  // Set alongside pendingInsightId for ANY insight deep-link that carries
  // askContext=1 (see InsightsInbox.jsx's runAction) — { label } drives the
  // amber "insight context" chip shown above the input (and inside the sent
  // message bubble once it goes out), visually distinct from a regular file
  // attachment chip. Covers every insight whose action lands on this page:
  // relief_headroom, provision, and digest cards alike.
  const [pendingInsightMeta, setPendingInsightMeta] = useState(null);
  // Guards the auto-send effect below so an insight deep-link is only ever
  // auto-sent once per arrival, even if this effect's dependencies
  // re-fire (e.g. activeEntity resolving after the initial mount).
  const autoSentInsightRef = useRef(null);

  // ── Chat history sidebar state ─────────────────────────────────────────
  const SESSIONS_PAGE_SIZE = 20;
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  // Whether an older page of sessions is currently being fetched (separate
  // from sessionsLoading, which is only the very first page's spinner) —
  // lets the list show a small "loading more…" row at the bottom instead of
  // blanking the whole sidebar while paging.
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  // Whether there's another page of older sessions the backend hasn't sent
  // yet. Starts true so the very first scroll-to-bottom check (before the
  // initial load even resolves) doesn't skip fetching.
  const [sessionsHasMore, setSessionsHasMore] = useState(true);

  // Distinct folder names the user has created (via the sidebar's "Add to
  // folder" menu) — offered as existing choices in SessionMenu's folder
  // submenu, alongside a "New folder…" option. Refreshed any time a session
  // is filed into a brand-new folder, so it doesn't require a full page
  // reload to show up as a pickable option for other sessions right away.
  const [folders, setFolders] = useState([]);

  async function refreshFolders() {
    const userId = localStorage.getItem('userId');
    if (!userId) { setFolders([]); return; }
    try {
      const res = await getChatFolders(userId, activeEntity?.id ?? null);
      setFolders(res?.folders || []);
    } catch (_) {
      // Leave the existing folder list as-is on failure — worst case the
      // submenu is briefly missing a folder someone just added elsewhere.
    }
  }

  // ── Chat history search ─────────────────────────────────────────────────
  // Searches BOTH session titles and message content (see searchChatSessions
  // / the backend's /api/chat/search) rather than titles alone — titles are
  // short AI-generated summaries that won't capture a specific figure, vendor
  // name, or ITA section a person might search for. Kept entirely separate
  // from the paginated `sessions` list above: while a search query is active
  // the sidebar renders `searchResults` instead of the normal recency-grouped
  // list, and scroll-triggered pagination is suspended (a search's results
  // already come back as one ranked list, not a page to infinitely-scroll).
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const isSearchActive = searchQuery.trim().length > 0;
  // Defaults open on desktop, same as Claude's own sidebar; persisted so a
  // returning user's collapse preference sticks across visits/reloads.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const stored = localStorage.getItem('cukaiChatSidebarOpen');
    return stored === null ? true : stored === 'true';
  });

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load active entity for context and listen for entity switches
  useEffect(() => {
    const loadEntity = async () => {
      const userId = localStorage.getItem('userId');
      if (!userId) return;
      try {
        // Don't assume activeEntityId already exists — this page can be the
        // first one a user lands on right after login. Resolve a default
        // entity here too, the same way Overview and ManageAccount do.
        const entities = await getAllEntities(userId).catch(() => []);
        const storedId = parseInt(localStorage.getItem('activeEntityId') || '0');
        let entity = entities.find((e) => e.id === storedId);
        if (!entity && entities.length > 0) {
          entity = entities[0];
          localStorage.setItem('activeEntityId', String(entity.id));
        }
        setActiveEntity(entity || null);
      } catch (_) {}
    };
    loadEntity();
    window.addEventListener('entitySwitch', loadEntity);
    return () => window.removeEventListener('entitySwitch', loadEntity);
  }, []);

  // Load the conversation for the active entity whenever it changes, so
  // switching entities swaps the chat history instead of carrying over the
  // previous entity's conversation. Resolves which session to resume in
  // priority order: an explicit `?session=` URL param first (e.g. a deep
  // link from elsewhere in the app), then this entity's last-active session
  // remembered in localStorage (see getPersistedSessionId) — so navigating
  // away to another page and back resumes the same conversation instead of
  // resetting to the empty/welcome state. If neither is present (or the
  // person explicitly started a new chat — see handleNewChat/handleClear,
  // which clear the persisted id), this falls through to the empty state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramSessionId = params.get('session');
    const paramInsightId = params.get('insightId');
    const paramAskContext = params.get('askContext') === '1';
    const paramTitle = params.get('title');
    const userId = localStorage.getItem('userId');
    const entityId = activeEntity?.id ?? null;

    // An insightId (from InsightsInbox's "Ask CukaiBot about this" /
    // "How to claim these" / "Plan year-end moves" card actions — see
    // runAction there) always starts a brand-new conversation grounded in
    // that specific card, rather than silently resuming whatever session
    // was last open, which may be about something unrelated. Stripped from
    // the URL immediately so a later refresh/back doesn't re-trigger it.
    if (paramInsightId) {
      setPendingInsightId(paramInsightId);
      setPendingInsightMeta(paramAskContext ? { label: paramTitle || 'Insight context' } : null);
      setInputValue('Tell me more about this and what I should do next.');
      setMessages([]);
      setDismissedFollowupIds(new Set());
      setActiveCitations([]);
      setActiveCitationsMessageId(null);
      setSessionId(null);
      const nextParams = new URLSearchParams(window.location.search);
      nextParams.delete('insightId');
      nextParams.delete('askContext');
      nextParams.delete('title');
      const qs = nextParams.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      return;
    }
    // A pending insight staged by a previous run of this effect (e.g. once
    // activeEntity finished resolving right after the branch above already
    // ran once) means a fresh, not-yet-sent conversation is already staged —
    // don't let this later re-run clobber it by resuming an unrelated old
    // session underneath the still-prefilled input box.
    if (pendingInsightId) return;

    const resumeSessionId = paramSessionId || getPersistedSessionId(entityId);

    if (!resumeSessionId || !userId) {
      setMessages([]);
      setDismissedFollowupIds(new Set());
      setActiveCitations([]);
      setActiveCitationsMessageId(null);
      setSessionId(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const history = await getChatHistory(resumeSessionId, userId);
        if (cancelled) return;
        setSessionId(history.sessionId);
        setMessages(history.messages || []);
        setDismissedFollowupIds(new Set());
        const lastWithCitations = [...(history.messages || [])].reverse().find(m => m.citations?.length);
        setActiveCitations(lastWithCitations?.citations || []);
        setActiveCitationsMessageId(lastWithCitations?.id ?? null);
        // Keep the persisted id and URL in sync with whatever actually
        // resolved — covers both "resumed from localStorage, URL didn't
        // have it yet" and "resumed from URL, localStorage was stale/unset".
        setPersistedSessionId(entityId, history.sessionId);
        const nextParams = new URLSearchParams(window.location.search);
        nextParams.set('session', history.sessionId);
        window.history.replaceState(null, '', `${window.location.pathname}?${nextParams}`);
      } catch (_) {
        if (cancelled) return;
        // Session id was invalid/stale/not owned by this user — fall back to
        // the same empty/welcome state a brand-new entity would show, and
        // stop remembering a session that no longer resolves.
        setMessages([]);
        setDismissedFollowupIds(new Set());
        setActiveCitations([]);
        setActiveCitationsMessageId(null);
        setSessionId(null);
        clearPersistedSessionId(entityId);
      }
    })();
    return () => { cancelled = true; };
    // pendingInsightId deliberately excluded — it's read only as a guard
    // against this effect's own earlier run, not something a change to it
    // should re-trigger (that would re-fetch/resume mid-staged-insight).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntity?.id]);

  // Auto-send an insight deep-link's staged prompt (relief_headroom,
  // provision, and digest cards alike — anything that passed askContext=1)
  // — the whole point of these cards' CukaiBot buttons is a one-tap handoff,
  // not "pre-fill the box and make the person click Send again". Waits on
  // activeEntity so the very first send already carries the right entity
  // context, same as a normal manually-sent message would. The ref guard
  // means this only ever fires once per arrival, even if activeEntity
  // resolves a moment after the initial mount and re-runs this effect. A
  // short delay lets the pre-filled prompt + context chip actually paint for
  // a moment first, rather than jumping straight to "already sent" with
  // nothing visible in between.
  useEffect(() => {
    if (pendingInsightMeta && pendingInsightId && autoSentInsightRef.current !== pendingInsightId) {
      autoSentInsightRef.current = pendingInsightId;
      const t = setTimeout(() => { handleSend(); }, 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInsightMeta, pendingInsightId, activeEntity]);

  // Load the sidebar's session list for the active entity, and reload it
  // whenever the entity changes — mirrors the message-history effect above,
  // so switching entities swaps both the conversation AND the sidebar list
  // together rather than leaving a stale list from the previous entity.
  //
  // Only ever fetches the first page (20 most-recent sessions) — this is
  // what runs on initial page load / entity switch, so the page never pulls
  // in a user's entire chat history just to render the sidebar. Older
  // sessions are fetched on demand by loadMoreSessions below, as the user
  // scrolls the list toward its bottom.
  async function refreshSessions() {
    const userId = localStorage.getItem('userId');
    if (!userId) { setSessions([]); setSessionsHasMore(false); return; }
    setSessionsLoading(true);
    try {
      const page = await getChatSessions(userId, activeEntity?.id ?? null, SESSIONS_PAGE_SIZE, 0);
      setSessions(page?.sessions || []);
      setSessionsHasMore(!!page?.hasMore);
    } catch (_) {
      setSessions([]);
      setSessionsHasMore(false);
    } finally {
      setSessionsLoading(false);
    }
  }

  // Sidebar infinite-scroll: fetches the next 20-session page and appends it
  // to the list already on screen. Guards against duplicate fetches (e.g.
  // a fast double-scroll firing the handler twice) by bailing out whenever
  // a fetch is already in flight or the backend has already said there's
  // nothing left to page in.
  async function loadMoreSessions() {
    if (sessionsLoadingMore || sessionsLoading || !sessionsHasMore) return;
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    setSessionsLoadingMore(true);
    try {
      const page = await getChatSessions(userId, activeEntity?.id ?? null, SESSIONS_PAGE_SIZE, sessions.length);
      setSessions((prev) => [...prev, ...(page?.sessions || [])]);
      setSessionsHasMore(!!page?.hasMore);
    } catch (_) {
      // Leave the existing list as-is on a failed page fetch — the user can
      // just scroll again to retry, rather than losing what's already shown.
    } finally {
      setSessionsLoadingMore(false);
    }
  }

  useEffect(() => {
    refreshSessions();
    refreshFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntity?.id]);

  // Debounced chat-history search: waits 300ms after the user stops typing
  // before hitting the backend, the standard "don't fire a request per
  // keystroke" pattern. Clearing the box (or it being all whitespace) just
  // empties the results and skips the network call entirely — the sidebar
  // falls back to rendering the normal paginated `sessions` list in that
  // case (see isSearchActive).
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    const userId = localStorage.getItem('userId');
    if (!userId) return;

    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchChatSessions(trimmed, userId, activeEntity?.id ?? null);
        if (!cancelled) setSearchResults(res?.results || []);
      } catch (_) {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery, activeEntity?.id]);

  useEffect(() => {
    if (messages.length > 2) { 
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  async function handleSend(text) {
    const trimmed = (text || inputValue).trim();
    // Ready-to-send attachments only — one still mid-upload or that failed
    // shouldn't be silently dropped from the send, so block sending instead
    // (the Send button's disabled state below mirrors this same check).
    const readyAttachments = pendingAttachments.filter((a) => a.status === 'ready');
    const hasBusyAttachment = pendingAttachments.some((a) => a.status === 'uploading');
    if (!trimmed && readyAttachments.length === 0) return;
    if (hasBusyAttachment) return;

    const userId = localStorage.getItem('userId');
    if (!userId) return;

    const userMsg = {
      id: Date.now(), role: 'user', text: trimmed, attachments: readyAttachments,
      insightContext: pendingInsightMeta,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setPendingAttachments([]);
    // Only the message that actually carries it should — clear now so a
    // later message in the same session (or a failed/retried send) doesn't
    // keep re-attaching a stale insight id.
    const insightIdForThisSend = pendingInsightId;
    setPendingInsightId(null);
    setPendingInsightMeta(null);
    setIsTyping(true);
    setActiveCitations([]);
    setActiveCitationsMessageId(null);

    try {
      const res = await sendChatMessage(
        trimmed, userId, activeEntity?.id ?? null, sessionId,
        readyAttachments.map((a) => a.id), insightIdForThisSend,
      );
      // First message of a brand-new conversation returns a freshly created
      // session_id — remember it so every subsequent message in this tab
      // continues the same thread instead of spawning a new one each time,
      // and persist it as this entity's active session so navigating away
      // and back resumes it too (see getPersistedSessionId).
      if (res.sessionId && res.sessionId !== sessionId) {
        setSessionId(res.sessionId);
        setPersistedSessionId(activeEntity?.id ?? null, res.sessionId);
        const params = new URLSearchParams(window.location.search);
        params.set('session', res.sessionId);
        window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
      }
      // Swap the optimistic user bubble for the server-echoed one (see
      // main.py's post_chat_message) — same client-side id, so this
      // replaces rather than duplicates it. Only needed when there were
      // attachments: the server's version carries real /files/ preview
      // URLs the optimistic bubble couldn't have had yet.
      if (res.userMessage && readyAttachments.length > 0) {
        setMessages((prev) => prev.map((m) => (
          m.id === userMsg.id
            ? { ...m, id: res.userMessage.id, attachments: res.userMessage.attachments || [] }
            : m
        )));
      }
      const botMsg = {
        id: res.message.id,
        role: 'assistant',
        text: res.message.text,
        citations: res.message.citations || [],
        followups: res.message.followups || [],
      };
      setMessages((prev) => [...prev, botMsg]);
      setActiveCitations(botMsg.citations);
      setActiveCitationsMessageId(botMsg.id);
      // Sidebar list needs refreshing either way: a brand-new session must
      // now appear in it (already carrying its final AI-generated title —
      // see main.py's post_chat_message, which resolves the title
      // synchronously as part of the classification call before this
      // response is even returned), and an existing one's updatedAt (used
      // for the "Today" grouping and sort order) has just changed too.
      refreshSessions();
    } catch (err) {
      const errMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        text: "Sorry, something went wrong reaching Cukai Bot. Please try again in a moment.",
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsTyping(false);
    }
  }

  // Fires on <input type="file"> change — uploads every picked file
  // immediately (see uploadChatAttachment) so the composer shows each as a
  // chip right away, independent of whether/when the message itself gets
  // sent. Each file gets its own optimistic 'uploading' placeholder (a
  // temporary negative id, so it can never collide with a real server id)
  // that's patched in place on success/failure — a slow upload doesn't
  // block picking or removing other files.
  async function handleFilesPicked(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-picking the same file name later
    if (!files.length) return;

    const userId = localStorage.getItem('userId');
    if (!userId) return;

    const room = MAX_CHAT_ATTACHMENTS_PER_MESSAGE - pendingAttachments.length;
    if (room <= 0) return;
    const toUpload = files.slice(0, room);

    const placeholders = toUpload.map((file) => ({
      id: -(Date.now() + Math.random()), // temp negative id, replaced on success
      name: file.name,
      status: 'uploading',
    }));
    setPendingAttachments((prev) => [...prev, ...placeholders]);

    await Promise.all(toUpload.map(async (file, idx) => {
      const placeholderId = placeholders[idx].id;
      try {
        const uploaded = await uploadChatAttachment(file, userId, sessionId);
        setPendingAttachments((prev) => prev.map((a) => (
          a.id === placeholderId ? { ...uploaded, status: 'ready' } : a
        )));
      } catch (err) {
        setPendingAttachments((prev) => prev.map((a) => (
          a.id === placeholderId ? { ...a, status: 'failed' } : a
        )));
      }
    }));
  }

  // Removes a pending (not-yet-sent) attachment chip. Best-effort backend
  // cleanup — if the delete call fails (e.g. it's a stale temp id, or a
  // network hiccup), the chip still disappears from the composer either
  // way, since from the user's perspective "removed" just means "not part
  // of my next message" regardless of whether the orphaned upload gets
  // cleaned up server-side.
  async function handleRemovePendingAttachment(attachment) {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    const userId = localStorage.getItem('userId');
    if (userId && attachment.id > 0) {
      try { await deleteChatAttachment(attachment.id, userId); } catch { /* best-effort */ }
    }
  }

  // Sidebar "New chat" button: unlike the old Clear Chat action, this does NOT delete the
  // current session — it just deselects it, so the conversation the person
  // was just in still shows up in the sidebar to come back to. A fresh
  // session is only actually created once they send their first message
  // (same as any brand-new conversation — see handleSend). Also clears the
  // persisted "active session for this entity" (see getPersistedSessionId)
  // so this explicit choice sticks: returning to this page later — even
  // after navigating elsewhere in the app first — stays on the new-chat
  // state instead of silently resuming the deselected conversation.
  function handleNewChat() {
    setMessages([]);
    setDismissedFollowupIds(new Set());
    setActiveCitations([]);
    setActiveCitationsMessageId(null);
    setInputValue('');
    setPendingAttachments([]);
    setSessionId(null);
    clearPersistedSessionId(activeEntity?.id ?? null);
    const params = new URLSearchParams(window.location.search);
    params.delete('session');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }

  // Sidebar row click: load that session's full history and make it active,
  // the same way resuming via a `?session=` URL param already works (see
  // the history-loading effect above) — just triggered by a click instead
  // of a page load.
  async function handleSelectSession(targetSessionId) {
    // Selecting a session (including re-selecting the one already open, if
    // that's what a search result pointed at) always dismisses any active
    // search — the sidebar should return to the normal recency list once the
    // user has picked what they were looking for, the same way typing a
    // search in Claude/ChatGPT and clicking a result closes the search UI.
    setSearchQuery('');
    if (targetSessionId === sessionId) return;
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    try {
      const history = await getChatHistory(targetSessionId, userId);
      setSessionId(history.sessionId);
      setMessages(history.messages || []);
      setDismissedFollowupIds(new Set());
      setPendingAttachments([]);
      const lastWithCitations = [...(history.messages || [])].reverse().find((m) => m.citations?.length);
      setActiveCitations(lastWithCitations?.citations || []);
      setActiveCitationsMessageId(lastWithCitations?.id ?? null);
      setPersistedSessionId(activeEntity?.id ?? null, history.sessionId);
      const params = new URLSearchParams(window.location.search);
      params.set('session', history.sessionId);
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    } catch (_) {
      // Stale/deleted session clicked from a list that hasn't refreshed yet
      // — drop it from the sidebar rather than leaving a dead entry.
      setSessions((prev) => prev.filter((s) => s.sessionId !== targetSessionId));
    }
  }

  // Message click handler (both UserMessage and AssistantMessage wire into
  // this): shows THAT turn's own citations in the side panel, instead of
  // always defaulting to only the newest response's. A user question has no
  // citations of its own — it's answered by the very next assistant message
  // in the array — so clicking a user bubble looks one slot ahead to find
  // the reply it produced. Clicking an assistant message with no citations
  // (e.g. a profile/small-talk answer that needed no retrieval — see
  // _classify_and_maybe_answer's fast path) still selects it, correctly
  // clearing the panel to empty for that turn rather than leaving a
  // different turn's sources looking active.
  function handleSelectCitations(clickedMessage) {
    let target = clickedMessage;
    if (clickedMessage.role === 'user') {
      const idx = messages.findIndex((m) => m.id === clickedMessage.id);
      target = idx !== -1 ? messages[idx + 1] : null;
    }
    if (!target || target.role !== 'assistant') return;
    setActiveCitations(target.citations || []);
    setActiveCitationsMessageId(target.id);
  }

  // Drops any folder from the local `folders` list that no longer has a
  // single session tagged with it — called after any action that can leave
  // a folder empty (removing a session from its folder, or deleting a
  // session outright) so a folder with nothing left in it disappears from
  // the sidebar and the "Add to folder" picker immediately, the same way it
  // would after a fresh refreshFolders() round-trip. Takes the up-to-date
  // sessions list explicitly (rather than reading the `sessions` state
  // variable) since this runs right alongside a setSessions call and state
  // updates aren't visible synchronously.
  function pruneEmptyFolders(updatedSessions) {
    const foldersStillInUse = new Set(updatedSessions.filter((s) => s.folder).map((s) => s.folder));
    setFolders((prev) => prev.filter((f) => foldersStillInUse.has(f)));
  }

  // Sidebar row's trash icon: deletes ANY session in the list, not just the
  // currently open one (that's the difference from handleClear, which only
  // ever acts on the active session). If the deleted session happens to be
  // the one currently open, also clear the main view so it doesn't keep
  // showing a conversation that no longer exists.
  async function handleDeleteSessionFromSidebar(targetSessionId) {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    const remaining = sessions.filter((s) => s.sessionId !== targetSessionId);
    setSessions(remaining);
    pruneEmptyFolders(remaining);
    if (targetSessionId === sessionId) {
      handleNewChat();
    }
    try {
      await deleteChatSession(targetSessionId, userId);
    } catch (_) {
      // Deletion failed server-side after we'd already optimistically
      // removed it from view — refresh from the server to reconcile rather
      // than leaving the sidebar showing a session that's actually still there.
      refreshSessions();
    }
  }

  // Applies a partial session update (pin/rename/folder) optimistically to
  // local state first, so the sidebar reacts instantly instead of waiting
  // on a round-trip, then persists it — reconciling from the server on
  // failure the same way handleDeleteSessionFromSidebar does, since an
  // optimistic update that silently didn't actually save would otherwise
  // look identical to one that succeeded.
  //
  // `localOnlyUpdates` (optional) are merged into local state alongside
  // `updates` but never sent to the server — for fields the server derives
  // itself from its own clock/logic (e.g. pinnedAt), where sending a
  // client-guessed value would be redundant at best and wrong at worst.
  async function patchSession(targetSessionId, updates, localOnlyUpdates = {}) {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    setSessions((prev) => prev.map((s) => (s.sessionId === targetSessionId ? { ...s, ...updates, ...localOnlyUpdates } : s)));
    try {
      await updateChatSession(targetSessionId, userId, updates);
    } catch (_) {
      refreshSessions();
    }
  }

  // Sidebar menu's Pin/Unpin action — re-sorts the list (pinned sessions
  // float to the top of their folder, or to their own top-level "Pinned"
  // group if unfiled) purely via the optimistic patch above; no separate
  // re-sort call needed since groupSessionsByRecency derives grouping and
  // ordering straight from each session's own `pinned`/`pinnedAt`/`folder`
  // fields.
  //
  // pinnedAt is set optimistically here (client's own clock) purely so the
  // pinned-group sort is instantly correct without waiting on a refetch —
  // it's local-display-only and NOT sent to the server: the PATCH body only
  // carries `pinned`, and the backend stamps its own pinned_at from the
  // request's actual server time (see update_chat_session). The next
  // refreshSessions() reconciles this local guess with that real value.
  function handlePinSession(targetSessionId, pinned) {
    patchSession(targetSessionId, { pinned }, {
      pinnedAt: pinned ? new Date().toISOString() : null,
    });
  }

  // Sidebar menu's Rename action (also reachable via the row's own inline
  // rename input) — also updates activeSessionTitle's source of truth
  // (`sessions`) so the page header's title swaps immediately if this is
  // the currently open conversation, without needing a separate reload.
  function handleRenameSession(targetSessionId, title) {
    patchSession(targetSessionId, { title });
  }

  // Sidebar menu's "Add to folder" / "Move to folder" action — also adds
  // the folder to the local `folders` list right away if it's brand new,
  // so it's immediately offered as a choice for other sessions without
  // waiting on refreshFolders' next round-trip.
  function handleAddSessionToFolder(targetSessionId, folder) {
    const updated = sessions.map((s) => (s.sessionId === targetSessionId ? { ...s, folder } : s));
    patchSession(targetSessionId, { folder });
    setFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder].sort()));
    // If this session was previously the last one filed under a *different*
    // folder, moving it here just emptied that other folder out — prune it
    // the same way handleRemoveSessionFromFolder does.
    pruneEmptyFolders(updated);
  }

  function handleRemoveSessionFromFolder(targetSessionId) {
    patchSession(targetSessionId, { folder: null });
    // The session just un-filed may have been the last one in its folder —
    // prune using the post-update session list so an emptied folder doesn't
    // linger in the sidebar or the "Add to folder" picker.
    pruneEmptyFolders(sessions.map((s) => (s.sessionId === targetSessionId ? { ...s, folder: null } : s)));
  }

  // Folder group header's "Rename folder" action — bulk-renames the folder
  // tag on every session currently filed under `oldName` (see
  // renameChatFolder). Applied optimistically to both `sessions` (so every
  // affected row's group membership updates immediately) and `folders`
  // (so the rename picker's list reflects the new name right away too),
  // then persisted server-side, reconciling from the server on failure.
  async function handleRenameFolder(oldName, newName) {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    setSessions((prev) => prev.map((s) => (s.folder === oldName ? { ...s, folder: newName } : s)));
    setFolders((prev) => {
      const next = prev.filter((f) => f !== oldName);
      return next.includes(newName) ? next : [...next, newName].sort();
    });
    try {
      await renameChatFolder(oldName, newName, userId, activeEntity?.id ?? null);
    } catch (_) {
      refreshSessions();
      refreshFolders();
    }
  }

  // Folder group header's "Delete folder" action — un-files every session
  // in that folder (their `folder` becomes null) rather than deleting the
  // conversations, so this only ever removes the grouping, never any chat
  // history. Applied optimistically the same way as the rename above.
  async function handleDeleteFolder(folderName) {
    const userId = localStorage.getItem('userId');
    if (!userId) return;
    setSessions((prev) => prev.map((s) => (s.folder === folderName ? { ...s, folder: null } : s)));
    setFolders((prev) => prev.filter((f) => f !== folderName));
    try {
      await deleteChatFolder(folderName, userId, activeEntity?.id ?? null);
    } catch (_) {
      refreshSessions();
      refreshFolders();
    }
  }

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('cukaiChatSidebarOpen', String(next));
      return next;
    });
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const showEmptyState = messages.length === 0;
  // Once a question has been asked, swap the static "Tax Advisory Assistant"
  // header for this conversation's own title — same title shown in the
  // sidebar (see main.py's post_chat_message, which generates it via the
  // classification call for a brand-new session). Looked up from `sessions`
  // rather than stored separately, since that list already carries every
  // session's title and stays in sync via refreshSessions(). Falls back to
  // the original static label whenever there's no active session yet (the
  // empty/welcome state) or its title hasn't loaded/generated yet.
  const activeSessionTitle = !showEmptyState
    ? sessions.find((s) => s.sessionId === sessionId)?.title
    : null;

  // id of the most recent assistant message — only THIS message is allowed
  // to show its inline "Suggested follow-ups" block (see AssistantMessage),
  // so an older reply never keeps displaying stale follow-up chips once the
  // conversation has moved on.
  const lastAssistantMessageId = [...messages].reverse().find((m) => m.role === 'assistant')?.id ?? null;

  return (
    <main className={`${embed ? 'h-screen' : 'h-[calc(100vh-4.1rem)]'} bg-background font-body flex flex-col overflow-hidden`}>
      <div className={`mx-auto w-full flex flex-col h-full overflow-hidden ${embed ? 'gap-2 px-3 py-3' : 'max-w-7xl gap-4 px-6 py-4'}`}>

        {/* ── Page Header (shrink-0 prevents it from squishing) ──
            Hidden in embed mode: the side panel already has its own header, and
            the tall title block would waste scarce vertical space in a panel. */}
        {!embed && (
          <div className="shrink-0">
            <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Cukai Bot</h1>
            {activeEntity &&
              <p className="mt-1 text-xs text-muted">
                Ask anything about Malaysian tax regulations, deductions, or {activeEntity.name} — powered by LHDN 2024 Guidelines.
              </p>
            }
          </div>
        )}

        {/* ── Master Split Layout Area ── */}
        <div className="flex flex-1 gap-6 min-h-0 overflow-hidden">

          {/* ── Chat History Sidebar (collapsible) ── */}
          <ChatHistorySidebar
            isOpen={sidebarOpen}
            onToggle={toggleSidebar}
            sessions={sessions}
            isLoading={sessionsLoading}
            isLoadingMore={sessionsLoadingMore}
            hasMore={sessionsHasMore}
            onLoadMore={loadMoreSessions}
            activeSessionId={sessionId}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
            onDeleteSession={handleDeleteSessionFromSidebar}
            onPinSession={handlePinSession}
            onRenameSession={handleRenameSession}
            onAddToFolder={handleAddSessionToFolder}
            onRemoveFromFolder={handleRemoveSessionFromFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            folders={folders}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchResults={searchResults}
            searchLoading={searchLoading}
            isSearchActive={isSearchActive}
          />

          {/* ── Left Column: Interactive Chat Stream Area ── */}
          <div className="flex-1 flex flex-col h-full min-w-0 rounded-2xl border border-border bg-surface shadow-sm overflow-hidden">
            
            {/* ── RE-ADDED CHAT HEADER (shrink-0 captures correct layout boundary) ── */}
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-tint">
                  <BotIcon className="h-6 w-6 object-contain" />
                </div>
                <div className="min-w-0">
                  <ChatHeaderTitle
                    title={activeSessionTitle}
                    sessionId={sessionId}
                    onRename={handleRenameSession}
                  />
                  <p className="text-xs text-muted">Powered by LHDN 2024 Guidelines</p>
                </div>
              </div>
            </div>

            {/* Scrollable Message Flow Box */}
            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-6 space-y-5">
              
              {/* Empty / welcome state */}
              {showEmptyState && (
                <div className="flex flex-col items-center justify-center py-4 text-center">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-tint">
                    <BotIcon className="h-6 w-6 object-contain" />
                  </div>
                  <h2 className="font-headings text-xl font-bold tracking-tight text-headings">How can I assist with your taxes today?</h2>
                  <p className="mt-1.5 max-w-xs text-xs text-muted">
                    Ask me anything about Malaysian tax regulations, deductions, or e-invoicing phases.
                  </p>
                  <div className="mt-4 grid w-full max-w-lg grid-cols-1 gap-2 text-left sm:grid-cols-2">
                    {suggestedPrompts.map(({ prompt, label, icon: Icon }) => (
                      <button
                        key={prompt}
                        onClick={() => handleSend(prompt)}
                        className="group flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 text-left shadow-sm transition-all hover:border-primary hover:bg-primary-tint"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary transition-colors group-hover:bg-surface">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-headings">{label}</span>
                          <span className="block truncate text-[11px] text-muted">{prompt}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Messages List */}
              {(messages || []).map((msg, i) => {
                if (msg.role === 'user') {
                  // A user turn's "active" state mirrors its paired reply's
                  // (the next message) — there's nothing citation-bearing on
                  // the question itself to compare against directly.
                  const reply = messages[i + 1];
                  const isActive = !!reply && reply.role === 'assistant' && reply.id === activeCitationsMessageId;
                  return (
                    <UserMessage
                      key={msg.id}
                      message={msg}
                      isActive={isActive}
                      onSelectCitations={handleSelectCitations}
                      onPreviewAttachment={setPreviewCitation}
                    />
                  );
                }
                return (
                  <AssistantMessage
                    key={msg.id}
                    message={msg}
                    isActive={msg.id === activeCitationsMessageId}
                    onSelectCitations={handleSelectCitations}
                    showFollowups={msg.id === lastAssistantMessageId && !dismissedFollowupIds.has(msg.id)}
                    onSelectFollowup={(prompt) => {
                      // Dismiss THIS message's follow-ups the moment one is
                      // clicked — the new reply that comes back gets its own
                      // fresh set (see lastAssistantMessageId), so there's
                      // never a moment where two messages both show chips.
                      setDismissedFollowupIds((prev) => new Set(prev).add(msg.id));
                      handleSend(prompt);
                    }}
                  />
                );
              })}

              {isTyping && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {/* Locked Footer Action/Input Tray */}
            <div className="border-t border-border p-4 shrink-0">
              {(pendingInsightMeta || pendingAttachments.length > 0) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {pendingInsightMeta && (
                    <InsightContextChip
                      meta={pendingInsightMeta}
                      onRemove={() => {
                        // Also mark this insight as "already handled" for the
                        // auto-send effect, in case removal happens in the
                        // brief window before the 400ms auto-send timer fires.
                        autoSentInsightRef.current = pendingInsightId;
                        setPendingInsightMeta(null);
                        setPendingInsightId(null);
                      }}
                    />
                  )}
                  {pendingAttachments.map((a) => (
                    <AttachmentChip
                      key={a.id}
                      attachment={a}
                      onRemove={() => handleRemovePendingAttachment(a)}
                    />
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2 rounded-xl border border-border bg-slate-50/50 px-3 py-2 transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about deductions, regulations, or upload a notice..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-xs text-headings placeholder-[#94A3B8] outline-none py-2 align-middle"
                  style={{ maxHeight: '96px' }}
                />
                <div className="flex shrink-0 items-center gap-1 pb-0.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFilesPicked}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={pendingAttachments.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE}
                    title={pendingAttachments.length >= MAX_CHAT_ATTACHMENTS_PER_MESSAGE ? `Up to ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} files per message` : 'Attach a file'}
                    className="rounded-lg p-1.5 text-muted transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <AttachIcon />
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={
                      (!inputValue.trim() && !pendingAttachments.some((a) => a.status === 'ready')) ||
                      pendingAttachments.some((a) => a.status === 'uploading') ||
                      isTyping
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-sm transition-all hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right Column: Fixed Side Panel ── */}
          <div className="hidden lg:flex lg:flex-col w-80 shrink-0 h-full min-h-0 gap-4 overflow-hidden">
            
            {/* Citation Box */}
            <div className="flex-1 flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm overflow-hidden">
              <div className="mb-4 flex items-center gap-2 shrink-0">
                <BookIcon className="text-primary" />
                <h2 className="text-sm font-bold text-headings">Active Citations</h2>
              </div>
              <p className="mb-4 text-xs text-muted shrink-0">
                {activeCitationsMessageId && activeCitationsMessageId !== messages[messages.length - 1]?.id
                  ? 'Sources for the selected message below. Click any other message to switch.'
                  : 'Sources referenced in the current response. Click an earlier message to view its sources.'}
              </p>

              {/* Scrollable container strictly within the right panel.
                  overflow-x-hidden matters here specifically: PDF-extracted
                  snippet text (e.g. a Public Ruling's long parenthetical
                  list like "(d) Busters/decollactors (e) Cables and
                  connectors...") can contain a run of short whitespace-
                  separated tokens with no natural wrap-friendly break, and
                  font-mono makes each character wider still. Without this,
                  that single long line grows this flex child's intrinsic
                  width, and the browser falls back to a horizontal
                  scrollbar on the WHOLE panel instead of wrapping — every
                  other card gets stretched to match, not just the one with
                  the long snippet. See CitationCard's snippet <p> below for
                  the matching break-words rule, which is the other half of
                  this fix (belt-and-suspenders: either alone mostly works,
                  but only both together guarantee it can't recur). */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 space-y-3 pr-1">
                {(activeCitations || []).length > 0 ? (
                  activeCitations.map((citation, i) => (
                    <CitationCard key={i} citation={citation} onPreview={setPreviewCitation} />
                  ))
                ) : (
                  <EmptyCitationsPlaceholder />
                )}
              </div>
            </div>

          </div>
        </div>

      </div>

      {previewCitation && (
        <DocumentPreviewModal citation={previewCitation} onClose={() => setPreviewCitation(null)} />
      )}
    </main>
  );
}

export default CukaiBot;