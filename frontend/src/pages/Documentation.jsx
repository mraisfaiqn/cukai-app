import { useState } from 'react';

// ── Icons ─────────────────────────────────────────────────────────────────────
const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CodeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
  </svg>
);

const FileTextIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const LayersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const ZapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const HelpCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SparkleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
  </svg>
);

const ChatIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const UserIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

// ── Documentation Data ─────────────────────────────────────────────────────────

const DOC_SECTIONS = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: <ZapIcon />,
    items: [
      {
        id: 'overview',
        title: 'Platform Overview',
        badge: null,
        content: {
          description: 'cukai.ai is a tax co-pilot built for Malaysian sole proprietors and small business owners. It reads the documents you upload, classifies them against LHDN\u2019s Form B categories, tracks your reliefs and deductions automatically, and surfaces savings opportunities and deadlines \u2014 so you spend less time hunting through receipts and more time running your business.',
          sections: [
            {
              heading: 'Core Modules',
              type: 'list',
              items: [
                { label: 'Overview', desc: 'Your dashboard \u2014 a snapshot of income, deductions, projected tax, unclaimed savings, and what needs your attention right now.' },
                { label: 'Cukai Documents', desc: 'Upload receipts, invoices, statements, and forms \u2014 cukai.ai reads and classifies each one automatically into the right Form B category.' },
                { label: 'Cukai Insights', desc: 'A running feed of AI-generated alerts: deductions you haven\u2019t claimed yet, upcoming deadlines, documents that need your input, and general advisory notes.' },
                { label: 'Cukai Bot', desc: 'A conversational assistant for Malaysian tax questions, grounded in LHDN guidelines and aware of your own business context.' },
                { label: 'Manage Account', desc: 'Your personal tax profile, business entities, and dependants \u2014 the facts Form B actually needs from you.' },
              ],
            },
            {
              heading: 'Who This Is For',
              type: 'paragraph',
              text: 'Malaysian sole proprietors and small business owners preparing an individual income tax return (Form B) under the Income Tax Act 1967, who want a structured, document-driven way to track income, expenses, and reliefs throughout the year instead of scrambling before the filing deadline.',
            },
          ],
        },
      },
      {
        id: 'navigation',
        title: 'Navigating the App',
        badge: null,
        content: {
          description: 'The top navigation bar gives you access to every part of cukai.ai. You can switch between them at any time without losing your place.',
          sections: [
            {
              heading: 'Where to find things',
              type: 'list',
              items: [
                { label: 'Overview', desc: 'Your dashboard home \u2014 a snapshot of your tax position and what needs attention.' },
                { label: 'Cukai Documents', desc: 'Upload, review, and manage every document you\u2019ve submitted.' },
                { label: 'Cukai Insights', desc: 'All AI-generated alerts, deadlines, and savings opportunities in one feed.' },
                { label: 'Cukai Bot', desc: 'Ask tax questions and get grounded, cited answers.' },
                { label: 'Manage Account', desc: 'Update your personal profile, business entities, and dependants \u2014 found under the account menu, top right.' },
                { label: 'User Manual', desc: 'This page \u2014 module guides and answers to common questions.' },
                { label: 'Terms & Conditions', desc: 'How cukai.ai handles your data and the limits of what it can do for you \u2014 also under the account menu.' },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'dashboard',
    label: 'Overview',
    icon: <LayersIcon />,
    items: [
      {
        id: 'dashboard-overview',
        title: 'What\u2019s on Your Overview Page',
        badge: null,
        content: {
          description: 'Overview is your home base \u2014 a single-glance summary of your tax position for the active business and year, plus anything that needs your attention.',
          sections: [
            {
              heading: 'What you\u2019ll see',
              type: 'list',
              items: [
                { label: 'Greeting & entity context', desc: 'Which business and year of assessment you\u2019re currently looking at, plus a countdown to your Form B deadline.' },
                { label: 'Action Required banner', desc: 'Appears whenever something \u2014 a document or an account-level item like an unpaid CP500 instalment \u2014 needs your review before filing.' },
                { label: 'Tax Health scores', desc: 'Two at-a-glance rings: how many eligible reliefs you\u2019ve actually claimed, and how complete your profile and documents are for generating Form B.' },
                { label: 'Key figures strip', desc: 'Year-to-date income, deductions, projected tax, and unclaimed savings.' },
                { label: 'Saving Opportunities', desc: 'The reliefs and deductions cukai.ai has spotted that you haven\u2019t fully claimed yet \u2014 click through to Cukai Insights for the full list.' },
                { label: 'Upcoming Deadlines', desc: 'Your nearest filing and payment dates.' },
                { label: 'Charts', desc: 'A breakdown of business expenses, personal expenses, and your overall tax summary for the year.' },
              ],
            },
          ],
        },
      },
      {
        id: 'switching-entities',
        title: 'Switching Between Businesses',
        badge: null,
        content: {
          description: 'If you run more than one business, every page \u2014 Overview, Cukai Documents, Cukai Insights \u2014 shows figures for whichever business entity is currently active.',
          sections: [
            {
              heading: 'Note',
              type: 'paragraph',
              text: 'Your personal profile and filed Form B are shared across all your businesses \u2014 only documents, capital assets, and business-specific totals change when you switch entities. See \u2018Business Entities\u2019 under Your Profile & Businesses for how to add or switch between them.',
            },
          ],
        },
      },
    ],
  },
  {
    id: 'cukai-documents',
    label: 'Cukai Documents',
    icon: <FileTextIcon />,
    items: [
      {
        id: 'documents-overview',
        title: 'Cukai Documents Overview',
        badge: 'Module',
        content: {
          description: 'Cukai Documents is where every receipt, invoice, bank statement, and form you upload gets read, classified, and organised \u2014 this is the evidence base everything else in cukai.ai is built on.',
          sections: [
            {
              heading: 'What happens when you upload a document',
              type: 'list',
              items: [
                { label: 'Reading', desc: 'Each document is scanned and its content analysed to identify what it is \u2014 an invoice, a bank statement, a filed Form B, and so on.' },
                { label: 'Classification', desc: 'It\u2019s slotted into a Form B category (business income, business expense, personal relief, etc.) and given a status \u2014 Income, Deductible, Relief, and so on.' },
                { label: 'Review flags', desc: 'Anything the AI can\u2019t confidently resolve on its own \u2014 an ambiguous category, a partially-deductible expense, low scan quality \u2014 is flagged as Needs Review so you make the final call.' },
              ],
            },
            {
              heading: 'Supported file types',
              type: 'paragraph',
              text: 'PDF, common image formats (JPG, PNG, etc.), and spreadsheets (Excel/CSV) are all supported. Multi-page PDFs are read in full, though very long documents may have a later section flagged if there\u2019s more content than can be processed in one pass \u2014 you\u2019ll see a note on the document if that happens.',
            },
          ],
        },
      },
      {
        id: 'status-badges',
        title: 'Document Status Badges',
        badge: null,
        content: {
          description: 'Every document carries a status badge summarising how it\u2019s treated for tax purposes. Here\u2019s what each one means:',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'Income', desc: 'Money received \u2014 declared as income on Form B, no deduction involved.' },
                { label: 'Deductible', desc: 'An allowable business expense that reduces your taxable business profit.' },
                { label: 'Needs Review', desc: 'Only partially deductible, or otherwise needs your confirmation before it\u2019s counted \u2014 e.g. client entertainment, which is capped at 50% by law.' },
                { label: 'Partially Deductible', desc: 'You\u2019ve already confirmed the deductible percentage for this document \u2014 only that portion counts from here on.' },
                { label: 'Relief', desc: 'A personal tax relief item \u2014 medical expenses, EPF contributions, education fees, and similar.' },
                { label: 'Donation', desc: 'An approved donation, deducted from your aggregate income separately from personal reliefs.' },
                { label: 'Personal', desc: 'Personal spending with no tax benefit \u2014 won\u2019t reduce your tax bill.' },
                { label: 'Capital Asset', desc: 'A capital purchase \u2014 machinery, equipment, and similar \u2014 claimed through capital allowance over several years, not as a one-off deduction.' },
                { label: 'Tax Instalment', desc: 'A CP500 instalment notice or payment \u2014 money already paid or scheduled toward this year\u2019s tax bill.' },
                { label: 'Not Applicable', desc: 'No financial content relevant to your tax return \u2014 e.g. a non-tax document.' },
                { label: 'Reference', desc: 'A supporting document \u2014 like a prior year\u2019s Form B or a P&L statement \u2014 kept for context. Never summed into your totals.' },
                { label: 'Category Removed', desc: 'This document\u2019s category no longer exists in the current classification system and needs to be reclassified.' },
                { label: 'Uploading\u2026 / Classifying\u2026 / Failed / Archived', desc: 'Where the document currently sits in the upload pipeline, or whether it\u2019s been moved out of your active list.' },
              ],
            },
          ],
        },
      },
      {
        id: 'filtering',
        title: 'Filtering & Searching',
        badge: null,
        content: {
          description: 'Use the filters above your document list to narrow down what you\u2019re looking at.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'All / Needs review / Failed / Archived', desc: 'Cross-cutting state filters \u2014 switch between everything, only items waiting on you, only failed uploads, or your archive.' },
                { label: 'Category filter', desc: 'Narrow by Form B section \u2014 Business Income, Personal Income, Business Expense, Personal Relief, Donations, Personal Expense, Tax Instalments, Tax Rebates, or Reference & Reconciliation.' },
                { label: 'Year filter', desc: 'Show documents for a specific year of assessment only.' },
                { label: 'Search', desc: 'Find a document by filename or vendor.' },
              ],
            },
          ],
        },
      },
      {
        id: 'reviewing',
        title: 'Reviewing & Reclassifying',
        badge: null,
        content: {
          description: 'Documents flagged Needs Review need a quick decision from you before they\u2019re counted toward your totals.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'Confirming a split', desc: 'For partially-deductible categories like client entertainment or a mixed-use vehicle, confirm the percentage that\u2019s genuinely business use.' },
                { label: 'Reclassifying', desc: 'If cukai.ai got the category wrong, correct it manually \u2014 your totals recalculate automatically.' },
                { label: 'Archiving', desc: 'Move a document out of your active list without deleting it \u2014 useful for duplicates or documents you\u2019ve superseded.' },
                { label: 'Manual entry', desc: 'Add a record by hand for anything that doesn\u2019t have a document to upload, like a cash transaction.' },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'cukai-insights',
    label: 'Cukai Insights',
    icon: <SparkleIcon />,
    items: [
      {
        id: 'insights-overview',
        title: 'Cukai Insights Overview',
        badge: 'AI Feature',
        content: {
          description: 'Cukai Insights is a running feed of everything cukai.ai has noticed that might need your attention \u2014 savings you haven\u2019t claimed, a deadline coming up, or a document that needs an answer from you before it can be counted.',
          sections: [
            {
              heading: 'What shows up here',
              type: 'list',
              items: [
                { label: 'Deadlines', desc: 'Upcoming filing or payment deadlines, like your Form B due date.' },
                { label: 'Needs Answer', desc: 'Something cukai.ai needs a decision on before it can finish a calculation.' },
                { label: 'Savings', desc: 'A relief or deduction you\u2019re eligible for but haven\u2019t fully claimed yet.' },
                { label: 'Advisory', desc: 'General guidance \u2014 a provisional note, a reminder tied to a prior year\u2019s Form B, or a periodic summary.' },
              ],
            },
          ],
        },
      },
      {
        id: 'insights-filters',
        title: 'Tabs & Filters',
        badge: null,
        content: {
          description: 'Use the tabs and filter chips at the top of the feed to focus on what matters right now.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'Active', desc: 'Everything still open and waiting on you.' },
                { label: 'Resolved', desc: 'Insights you\u2019ve acted on \u2014 these move here automatically.' },
                { label: 'Dismissed', desc: 'Insights you\u2019ve dismissed; they won\u2019t be re-raised.' },
                { label: 'Group filters', desc: 'All, Deadlines, Needs Answer, Savings, or Advisory \u2014 narrow the feed to one kind of insight.' },
              ],
            },
          ],
        },
      },
      {
        id: 'insights-actions',
        title: 'Taking Action on an Insight',
        badge: null,
        content: {
          description: 'Each insight card gives you a way to act on it directly, without leaving the page.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'Open the linked document', desc: 'If an insight is tied to a specific document, jump straight to it in Cukai Documents.' },
                { label: 'Dismiss', desc: 'Not relevant? Dismiss it \u2014 with an optional reason \u2014 and it moves out of your active feed.' },
                { label: 'Snooze', desc: 'Push a reminder to a later date if you\u2019re not ready to deal with it yet.' },
                { label: 'Mark resolved', desc: 'Once you\u2019ve acted on it outside the app \u2014 e.g. made a payment \u2014 mark it resolved so it stops surfacing.' },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'cukai-bot',
    label: 'Cukai Bot',
    icon: <ChatIcon />,
    items: [
      {
        id: 'bot-overview',
        title: 'Cukai Bot Overview',
        badge: 'AI Feature',
        content: {
          description: 'Cukai Bot is a conversational assistant for Malaysian tax questions. Ask it about a deduction, a relief, or how a specific rule applies to your business, and it answers grounded in LHDN guidelines \u2014 with sources you can check.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'Entity-aware', desc: 'Cukai Bot knows which business entity you currently have active, so its answers can reference your own context where relevant.' },
                { label: 'Chat history', desc: 'Previous conversations are saved per business entity so you can pick up where you left off.' },
              ],
            },
          ],
        },
      },
      {
        id: 'bot-citations',
        title: 'Citations & Sources',
        badge: null,
        content: {
          description: 'Where possible, Cukai Bot backs up its answers with citations you can inspect.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'Citation panel', desc: 'Shows the specific source \u2014 a regulation, a guideline, or one of your own documents \u2014 behind a claim in the chat.' },
                { label: 'Document preview', desc: 'Click a citation that references one of your own documents to preview it directly, without leaving the conversation.' },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'account',
    label: 'Profile & Entities',
    icon: <UserIcon />,
    items: [
      {
        id: 'personal-profile',
        title: 'Personal Profile',
        badge: null,
        content: {
          description: 'Your Personal Profile holds the identity, contact, and household facts Form B needs from you as an individual \u2014 separate from any one business.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'Identity & residency', desc: 'Full name, TIN, IC/passport number, citizenship, date of birth, gender.' },
                { label: 'Marital & dependants', desc: 'Marital status and spouse details if married \u2014 this drives spouse relief and joint assessment.' },
                { label: 'Contact & refund details', desc: 'Your correspondence address and how you\u2019d like any tax refund paid \u2014 bank transfer or DuitNow.' },
                { label: 'Why it matters', desc: 'cukai.ai checks this profile is complete before generating your Form B, and tells you exactly which field is missing if it isn\u2019t.' },
              ],
            },
          ],
        },
      },
      {
        id: 'business-entities',
        title: 'Business Entities',
        badge: null,
        content: {
          description: 'If you run more than one business, each one is set up as its own entity \u2014 its documents, capital assets, and figures stay separate, while your personal profile and filed Form B stay shared across all of them.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'Adding a business', desc: 'Register a new entity with its name and MSIC business code.' },
                { label: 'Switching between entities', desc: 'Use the entity selector to change which business\u2019s documents and figures you\u2019re looking at throughout the app.' },
                { label: 'Opening balances', desc: 'For a business you\u2019re already running, set an opening unabsorbed business loss / capital allowance so brought-forward figures carry through correctly from day one.' },
              ],
            },
          ],
        },
      },
      {
        id: 'children',
        title: 'Children (Child Relief)',
        badge: null,
        content: {
          description: 'Add a record for each child to have their child relief tier calculated automatically, instead of a flat estimate.',
          sections: [
            {
              heading: '',
              type: 'list',
              items: [
                { label: 'What\u2019s tracked', desc: 'Date of birth, disability status, and full-time student / higher-education status \u2014 the exact facts LHDN\u2019s child relief tiers depend on.' },
                { label: 'Shared custody', desc: 'Set an eligibility percentage if relief for a child is split with a co-parent.' },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: 'faq',
    label: 'FAQ',
    icon: <HelpCircleIcon />,
    items: [
      {
        id: 'faq-general',
        title: 'General Questions',
        badge: null,
        content: {
          description: 'Answers to the questions we hear most often. If yours isn\u2019t here, the module guides above cover most workflows in more depth \u2014 start there before reaching out to support.',
          sections: [
            {
              heading: '',
              type: 'faq',
              items: [
                {
                  q: 'Is cukai.ai a licensed tax agent?',
                  a: 'No. cukai.ai is a software tool that provides AI-assisted guidance based on publicly available LHDN regulations and the documents you provide. It is not a licensed tax agent, and nothing it produces is a substitute for advice from one. Always have a qualified tax agent review your figures before filing.',
                },
                {
                  q: 'Can I submit my tax return directly to LHDN through cukai.ai?',
                  a: 'No. cukai.ai helps you prepare, organise, and review your figures. Actual submission to LHDN must be done through MyTax (mytax.hasil.gov.my) or a licensed tax agent.',
                },
                {
                  q: 'How accurate are the AI-generated figures?',
                  a: 'Accuracy depends entirely on the completeness and correctness of the documents you upload and the profile information you provide. Treat every AI-generated figure as an estimate to be verified, never as a final number.',
                },
                {
                  q: 'Is my data stored securely?',
                  a: 'See the Terms & Conditions page for full details on how your data is collected, used, and protected, including your rights under Malaysia\u2019s Personal Data Protection Act 2010.',
                },
                {
                  q: 'What\u2019s the difference between Cukai Bot and Cukai Documents?',
                  a: 'Cukai Bot is a conversational assistant for asking tax questions and getting regulation-based guidance. Cukai Documents is where you upload, classify, and manage the actual documents and figures that feed your tax return.',
                },
                {
                  q: 'A document I uploaded shows Needs Review \u2014 what do I do?',
                  a: 'Open it in Cukai Documents and check the reason shown on the document \u2014 usually a percentage split to confirm or a category to correct. See \u2018Reviewing & Reclassifying\u2019 under Cukai Documents above.',
                },
                {
                  q: 'I still need help \u2014 what should I do?',
                  a: 'Start with the module guide for the page you\u2019re stuck on \u2014 most workflows are covered above. If you\u2019re still stuck, or you\u2019ve found something that looks like a bug, reach out to your organisation\u2019s cukai.ai support contact.',
                },
              ],
            },
          ],
        },
      },
    ],
  },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

const METHOD_COLOR = {
  GET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  POST: 'bg-blue-50 text-blue-700 border-blue-200',
  PUT: 'bg-amber-50 text-amber-700 border-amber-200',
  DELETE: 'bg-red-50 text-red-700 border-red-200',
};

function CodeBlock({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-1 rounded-lg border border-slate-200 bg-slate-900 px-4 py-3 font-mono text-xs text-slate-300">
      <span>{text}</span>
      <button
        onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm font-semibold text-headings hover:text-primary"
      >
        {q}
        <span className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}><ChevronDownIcon /></span>
      </button>
      {open && <p className="pb-4 text-sm leading-relaxed text-[#334155]">{a}</p>}
    </div>
  );
}

function DocContent({ item }) {
  if (!item) return null;
  const { content } = item;
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-xl font-bold text-headings">{item.title}</h2>
          {item.badge && (
            <span className="rounded-full border border-primary/20 bg-primary-tint px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              {item.badge}
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-muted">{content.description}</p>
      </div>

      {content.sections.map((sec, i) => (
        <div key={i} className="space-y-3">
          {sec.heading && <h3 className="text-sm font-bold text-headings">{sec.heading}</h3>}

          {sec.type === 'paragraph' && (
            <p className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-[#334155]">{sec.text}</p>
          )}

          {sec.type === 'list' && (
            <div className="space-y-2">
              {sec.items.map((it, j) => (
                <div key={j} className="flex gap-3 rounded-xl border border-slate-100 bg-surface px-4 py-3 shadow-sm">
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div>
                    <p className="text-sm font-semibold text-headings">{it.label}</p>
                    <p className="text-xs leading-relaxed text-muted">{it.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {sec.type === 'api' && (
            <div className="space-y-2">
              {sec.endpoints.map((ep, j) => (
                <div key={j} className="rounded-xl border border-slate-100 bg-surface px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${METHOD_COLOR[ep.method] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                      {ep.method}
                    </span>
                    <CodeBlock text={ep.path} />
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{ep.desc}</p>
                </div>
              ))}
            </div>
          )}

          {sec.type === 'faq' && (
            <div className="rounded-xl border border-slate-100 bg-surface px-5 shadow-sm">
              {sec.items.map((it, j) => <FaqItem key={j} q={it.q} a={it.a} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

function Documentation() {
  const allItems = DOC_SECTIONS.flatMap(s => s.items);
  const [activeId, setActiveId] = useState('overview');
  const [openSections, setOpenSections] = useState({ 'getting-started': true });
  const [search, setSearch] = useState('');

  const toggleSection = (id) => setOpenSections(p => ({ ...p, [id]: !p[id] }));

  const activeItem = allItems.find(i => i.id === activeId);

  const filteredSections = search
    ? DOC_SECTIONS.map(sec => ({
        ...sec,
        items: sec.items.filter(it =>
          it.title.toLowerCase().includes(search.toLowerCase()) ||
          it.content.description.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(sec => sec.items.length > 0)
    : DOC_SECTIONS;

  return (
    // ── FIXED VIEWPORT FRAME (Matches InsightsInbox.jsx) ──
    <main className="h-[calc(100vh-4.1rem)] bg-background font-body flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        {/* ── Page Header (shrink-0 prevents it from squishing) ── */}
        <div className="flex flex-col gap-1 shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">User Manual</h1>
          <p className="text-xs text-muted mt-1">A guide to every feature in cukai.ai — what each page does and how to use it. Start here before reaching out to support.</p>
        </div>

        {/* ── Master Split Layout ── */}
        <div className="flex flex-1 gap-6 min-h-0 overflow-hidden">

          {/* ── Desktop Sidebar (Now independently scrollable) ── */}
          <aside className="hidden w-60 shrink-0 lg:flex lg:flex-col h-full overflow-y-auto pr-2">
            <div className="space-y-2">
              {/* Search */}
              <div className="relative mb-3 sticky top-0 bg-background pb-1 z-10">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]"><SearchIcon /></span>
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); }}
                  placeholder="Search docs…"
                  className="w-full rounded-xl border border-slate-200 bg-surface py-2 pl-9 pr-3 text-xs text-headings placeholder-[#94A3B8] shadow-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>

              {filteredSections.map(sec => (
                <div key={sec.id}>
                  <button
                    onClick={() => toggleSection(sec.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted"
                  >
                    <span className="text-primary">{sec.icon}</span>
                    {sec.label}
                    <span className={`ml-auto transition-transform ${openSections[sec.id] ? 'rotate-90' : ''}`}><ChevronRightIcon /></span>
                  </button>
                  {openSections[sec.id] && (
                    <div className="ml-2 mt-1 space-y-0.5 border-l border-slate-200 pl-3">
                      {sec.items.map(item => (
                        <button
                          key={item.id}
                          onClick={() => { setActiveId(item.id); setSearch(''); }}
                          className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${activeId === item.id ? 'bg-[#0F172A] font-semibold text-white' : 'text-[#334155] hover:bg-slate-100 hover:text-headings'}`}
                        >
                          {item.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </aside>

          {/* ── Main Content Column ── */}
          <div className="min-w-0 flex-1 flex flex-col h-full overflow-hidden">
            
            {/* Mobile search results view */}
            {search ? (
              <div className="mb-3 max-h-40 overflow-y-auto space-y-2 lg:hidden shrink-0">
                {filteredSections.flatMap(sec => sec.items).map(item => (
                  <button key={item.id} onClick={() => { setActiveId(item.id); setSearch(''); }} className="block w-full rounded-xl border border-slate-100 bg-surface px-4 py-3 text-left shadow-sm hover:border-primary/30">
                    <p className="text-sm font-semibold text-headings">{item.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{item.content.description}</p>
                  </button>
                ))}
              </div>
            ) : null}

            {/* Mobile nav horizontal chip tray */}
            <div className="mb-3 flex flex-wrap gap-2 lg:hidden shrink-0 max-h-24 overflow-y-auto pb-1">
              {allItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setActiveId(item.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-all ${activeId === item.id ? 'border-[#0F172A] bg-[#0F172A] text-white' : 'border-slate-200 bg-surface text-muted'}`}
                >
                  {item.title}
                </button>
              ))}
            </div>

            {/* ── INDEPENDENTLY SCROLLABLE READING CARD ── */}
            <div className="flex-1 overflow-y-auto min-h-0 rounded-2xl border border-slate-100 bg-surface p-6 shadow-sm">
              <DocContent item={activeItem} />
            </div>

            {/* ── Version Footer Sticky Note ── */}
            <div className="mt-3 flex items-center justify-between shrink-0">
              <p className="text-[10px] text-[#94A3B8]">cukai.ai — User Manual · Updated as new features ship.</p>
              <div className="flex items-center gap-1">
                {allItems.map((item, i) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveId(item.id)}
                    title={item.title}
                    className={`h-1.5 rounded-full transition-all ${activeId === item.id ? 'w-4 bg-primary' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}`}
                  />
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}

export default Documentation;