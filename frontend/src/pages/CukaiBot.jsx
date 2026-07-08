import { useState, useRef, useEffect } from 'react';
import { getAllEntities } from '../services/api';
import cukaiBot from '../assets/cukaibot-icon.png';
// import { jsPDF } from 'jspdf';

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

const CheckCircleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const ClearIcon = () => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className="h-4 w-4" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <polyline points="3 3 3 8 8 8" />
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SparkleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

// ── Mock conversation data ───────────────────────────────────────────────────
// Keyed by entity ID so switching entities swaps the conversation, the same
// way a real chat-history endpoint will be scoped once the backend exists.
// Entities with no seeded conversation simply fall through to the empty/
// welcome state (see getInitialMessagesForEntity below) — this is the same
// fallback a real fetch would hit for a brand-new entity with no history yet.
//
// TODO(backend): once a chat endpoint exists, replace getInitialMessagesForEntity
// with something like `await API.getChatHistory(userId, entityId)`, called from
// the same useEffect that already re-runs on activeEntity?.id below.

const suggestedPrompts = [
  'Can I claim broadband as a business expense?',
  'What is the Section 33 deduction limit?',
  'Explain the 2025 e-invoicing phases.',
  'How do I claim medical relief for my parents?',
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
        { tag: 'ITA 1967', title: 'Section 46(1)(c)', snippet: '"medical treatment, special needs or carer expenses expended in that basis year by that individual for his…"', verified: 'Verified against 2024 Gazette' },
        { tag: 'PUBLIC RULING', title: 'PR No. 11/2021', snippet: 'Guidelines on the deduction for expenses in relation to medical treatment for parents.' },
      ],
    },
  ],
};

/** Mirrors what a real per-entity chat history fetch would resolve to. */
function getInitialMessagesForEntity(entityId) {
  return MOCK_MESSAGES_BY_ENTITY[entityId] || [];
}

// ── Sub-components ───────────────────────────────────────────────────────────

function CitationCard({ citation }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center rounded-full bg-headings px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          {citation.tag}
        </span>
        <button className="text-muted transition-colors hover:text-primary">
          <ExternalLinkIcon />
        </button>
      </div>
      <p className="text-sm font-semibold text-headings">{citation.title}</p>
      <p className="mt-1.5 font-mono text-xs leading-relaxed text-muted">{citation.snippet}</p>
      {citation.verified && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5">
          <CheckCircleIcon />
          <span className="text-xs font-medium text-primary">{citation.verified}</span>
        </div>
      )}
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

function AssistantMessage({ message }) {
  return (
    <div className="flex gap-3">
      {/* Bot avatar */}
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-primary-tint text-primary">
        <BotIcon className="h-6 w-6 object-contain" />
      </div>

      <div className="flex-1 space-y-3">
        <p className="text-xs leading-relaxed text-[#334155]">{message.text}</p>

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
      </div>
    </div>
  );
}

function UserMessage({ message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-headings px-4 py-3">
        <p className="text-xs leading-relaxed text-white">{message.text}</p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
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

// ── Main Component ───────────────────────────────────────────────────────────

function CukaiBot() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeCitations, setActiveCitations] = useState([]);
  const [activeEntity, setActiveEntity] = useState(null);
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
  // previous entity's conversation. Mock-data today; swap for a real fetch
  // (e.g. API.getChatHistory(userId, activeEntity.id)) once the chat backend
  // exists — the effect shape stays the same.
  useEffect(() => {
    const entityMessages = getInitialMessagesForEntity(activeEntity?.id);
    setMessages(entityMessages);
    const lastWithCitations = [...entityMessages].reverse().find(m => m.citations);
    setActiveCitations(lastWithCitations?.citations || []);
  }, [activeEntity?.id]);

  useEffect(() => {
    if (messages.length > 2) { 
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  function handleSend(text) {
    const trimmed = (text || inputValue).trim();
    if (!trimmed) return;

    const userMsg = { id: Date.now(), role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);
    setActiveCitations([]);

    setTimeout(() => {
      const botMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        text: `Based on LHDN's current guidelines, here is what you need to know regarding your question about "${trimmed}". Under the Income Tax Act 1967 and relevant Public Rulings, there are specific rules and limitations that apply. Please consult a licensed tax agent to verify your specific circumstances before filing.`,
        citations: [
          { tag: 'ITA 1967', title: 'Section 33(1)', snippet: '"...deductions shall be allowed for all outgoings and expenses wholly and exclusively incurred during that period..."', verified: 'Verified against 2024 Gazette' },
          { tag: 'PUBLIC RULING', title: 'PR No. 4/2023', snippet: 'Guidelines on deductibility of expenses for businesses under the self-assessment system.' },
        ],
      };
      setIsTyping(false);
      setMessages((prev) => [...prev, botMsg]);
      setActiveCitations(botMsg.citations);
    }, 1800);
  }

  function handleClear() {
    setMessages([]);
    setActiveCitations([]);
    setInputValue('');
  }

  // ── Export the current chat session to a downloadable PDF ──────────────────
  // Dumps every message in the transcript, then appends the sidebar's
  // "Active Citations" (the same `activeCitations` state driving the right
  // panel) as its own section at the very end of the document.
  function handleExportPDF() {
    if (!messages || messages.length === 0) return;

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 48;
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    const addLine = (text, { size = 10, style = 'normal', color = [15, 23, 42], gap = 14 } = {}) => {
      doc.setFont('helvetica', style);
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach((line) => {
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += gap;
      });
    };

    const addRule = (gapBefore = 6, gapAfter = 16) => {
      y += gapBefore;
      if (y > pageHeight - margin) { doc.addPage(); y = margin; }
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += gapAfter;
    };

    // ── Document header ──
    addLine('Cukai Bot Conversation', { size: 16, style: 'bold', gap: 22 });
    if (activeEntity) addLine(`Entity: ${activeEntity.name}`, { size: 9, color: [100, 116, 139], gap: 12 });
    addLine(`Exported ${new Date().toLocaleString('en-MY')}`, { size: 9, color: [100, 116, 139], gap: 20 });

    // ── Messages ──
    messages.forEach((msg) => {
      const speaker = msg.role === 'user' ? 'You' : 'Cukai Bot';
      addLine(speaker, { size: 10, style: 'bold', color: msg.role === 'user' ? [15, 23, 42] : [13, 148, 136], gap: 14 });
      addLine(msg.text, { size: 10, gap: 14 });

      if (msg.structured) {
        const h = msg.structured.highlight;
        if (h) {
          addLine(`${h.label}: ${h.value}`, { size: 10, style: 'bold', gap: 14 });
          if (h.note) addLine(h.note, { size: 9, color: [100, 116, 139], gap: 12 });
        }
        (msg.structured.checkItems || []).forEach((item) => {
          addLine(`\u2022 ${item.bold} ${item.text}`, { size: 9, gap: 12 });
        });
      }

      y += 8; // gap between messages
    });

    // ── Active Citations — appended as its own section at the end, mirroring
    //    the right-hand sidebar's current state rather than per-message data ──
    if (activeCitations && activeCitations.length > 0) {
      addRule();
      addLine('Active Citations', { size: 13, style: 'bold', gap: 18 });
      activeCitations.forEach((c) => {
        addLine(`[${c.tag}] ${c.title}`, { size: 10, style: 'bold', gap: 13 });
        if (c.snippet) addLine(c.snippet, { size: 9, style: 'italic', color: [100, 116, 139], gap: 12 });
        if (c.verified) addLine(c.verified, { size: 8, color: [13, 148, 136], gap: 11 });
        y += 6;
      });
    }

    const entityPart = activeEntity ? activeEntity.name.replace(/[^\w-]+/g, '_') : 'session';
    const datePart = new Date().toISOString().slice(0, 10);
    doc.save(`cukaibot-${entityPart}-${datePart}.pdf`);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const showEmptyState = messages.length === 0;

  return (
    <main className="h-[calc(100vh-4.1rem)] bg-background font-body flex flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-7xl flex flex-col gap-4 px-6 py-4 h-full overflow-hidden">

        {/* ── Page Header (shrink-0 prevents it from squishing) ── */}
        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Cukai Bot</h1>
      {activeEntity && <p className="text-xs text-muted mt-0.5">Context: {activeEntity.name}</p>}
          <p className="mt-1 text-xs text-muted">
            Ask anything about Malaysian tax regulations, deductions, or e-invoicing — powered by LHDN 2024 Guidelines.
          </p>
        </div>

        {/* ── Master Split Layout Area ── */}
        <div className="flex flex-1 gap-6 min-h-0 overflow-hidden">

          {/* ── Left Column: Interactive Chat Stream Area ── */}
          <div className="flex-1 flex flex-col h-full min-w-0 rounded-2xl border border-border bg-surface shadow-sm overflow-hidden">
            
            {/* ── RE-ADDED CHAT HEADER (shrink-0 captures correct layout boundary) ── */}
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-tint">
                  <BotIcon className="h-6 w-6 object-contain" />
                </div>
                <div>
                  <p className="text-sm font-bold text-headings">Tax Advisory Assistant</p>
                  <p className="text-xs text-muted">Powered by LHDN 2024 Guidelines</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClear}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-muted shadow-sm transition-colors hover:bg-slate-50 hover:text-headings"
                >
                  <ClearIcon />
                  Clear Chat
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={showEmptyState}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-muted shadow-sm transition-colors hover:bg-slate-50 hover:text-headings disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <DownloadIcon />
                  Export
                </button>
              </div>
            </div>

            {/* Scrollable Message Flow Box */}
            <div className="flex-1 overflow-y-auto min-h-0 px-5 py-6 space-y-5">
              
              {/* Empty / welcome state */}
              {showEmptyState && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-tint">
                    <BotIcon className="h-8 w-8 object-contain" />
                  </div>
                  <h2 className="font-headings text-2xl font-bold tracking-tight text-headings">How can I assist with your taxes today?</h2>
                  <p className="mt-2 max-w-xs text-xs text-muted">
                    Ask me anything about Malaysian tax regulations, deductions, or e-invoicing phases.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {suggestedPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleSend(prompt)}
                        className="rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium text-[#334155] shadow-sm transition-all hover:border-primary hover:bg-primary-tint hover:text-primary"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Messages List */}
              {(messages || []).map((msg) =>
                msg.role === 'user'
                  ? <UserMessage key={msg.id} message={msg} />
                  : <AssistantMessage key={msg.id} message={msg} />
              )}

              {isTyping && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {/* Contextual Chips Tray Container */}
            {!showEmptyState && (
              <div className="border-t border-slate-50 px-5 py-2.5 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
                {(suggestedPrompts || []).slice(0, 3).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    className="shrink-0 rounded-full border border-border bg-slate-50 px-3 py-1.5 text-xs font-medium text-muted transition-all hover:border-primary hover:bg-primary-tint hover:text-primary"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Locked Footer Action/Input Tray */}
            <div className="border-t border-border p-4 shrink-0">
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
                  <button type="button" className="rounded-lg p-1.5 text-muted transition-colors hover:bg-slate-200">
                    <AttachIcon />
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={!inputValue.trim() || isTyping}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-sm transition-all hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-center text-[10px] text-[#94A3B8]">
                AI can make mistakes. Always verify with official LHDN resources.
              </p>
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
              <p className="mb-4 text-xs text-muted shrink-0">Sources referenced in the current response.</p>

              {/* Scrollable container strictly within the right panel */}
              <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
                {(activeCitations || []).length > 0 ? (
                  activeCitations.map((citation, i) => (
                    <CitationCard key={i} citation={citation} />
                  ))
                ) : (
                  <EmptyCitationsPlaceholder />
                )}
              </div>
            </div>

            {/* Disclaimer Notice Block */}
            <div className="rounded-2xl border border-warning/30 bg-warning-bg p-4 shrink-0">
              <p className="text-xs font-semibold text-warning">Important Notice</p>
              <p className="mt-1.5 text-xs leading-relaxed text-warning">
                Cukai Bot provides guidance based on publicly available LHDN regulations. Always consult a licensed tax agent for filing advice specific to your situation.
              </p>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}

export default CukaiBot;