import { useState, useRef, useEffect } from 'react';
import cukaiBot from '../assets/cukaibot-icon.png';

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
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#10B981]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const ClearIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
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
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#0D9488]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

const suggestedPrompts = [
  'Can I claim broadband as a business expense?',
  'What is the Section 33 deduction limit?',
  'Explain the 2025 e-invoicing phases.',
  'How do I claim medical relief for my parents?',
];

const initialMessages = [
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
];

// ── Sub-components ───────────────────────────────────────────────────────────

function CitationCard({ citation }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="inline-flex items-center rounded-md bg-[#0F172A] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          {citation.tag}
        </span>
        <button className="text-[#64748B] transition-colors hover:text-[#0D9488]">
          <ExternalLinkIcon />
        </button>
      </div>
      <p className="text-sm font-semibold text-[#0F172A]">{citation.title}</p>
      <p className="mt-1.5 font-mono text-xs leading-relaxed text-[#64748B]">{citation.snippet}</p>
      {citation.verified && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
          <CheckCircleIcon />
          <span className="text-xs font-medium text-[#10B981]">{citation.verified}</span>
        </div>
      )}
    </div>
  );
}

function EmptyCitationsPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
      <FileTextIcon className="mb-2 h-8 w-8 text-slate-300" />
      <p className="mt-2 text-sm text-[#64748B]">Ask more questions to generate relevant citations.</p>
    </div>
  );
}

function AssistantMessage({ message }) {
  return (
    <div className="flex gap-3">
      {/* Bot avatar */}
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-100 bg-[#f0fdf9] text-[#0D9488]">
        <BotIcon />
      </div>

      <div className="flex-1 space-y-3">
        <p className="text-sm leading-relaxed text-[#334155]">{message.text}</p>

        {message.structured && (
          <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            {/* Highlight block */}
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2 mb-1">
                <SparkleIcon />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#64748B]">
                  {message.structured.highlight.label}
                </span>
              </div>
              <p className="text-2xl font-bold text-[#0F172A]">{message.structured.highlight.value}</p>
              <p className="mt-1 text-xs text-[#64748B]">{message.structured.highlight.note}</p>
            </div>

            {/* Check items */}
            <div className="divide-y divide-slate-50 px-5 py-2">
              {message.structured.checkItems.map((item, i) => (
                <div key={i} className="flex items-start gap-3 py-3">
                  <CheckCircleIcon />
                  <p className="text-sm text-[#334155]">
                    <span className="font-semibold text-[#0F172A]">{item.bold} </span>
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
      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-[#0F172A] px-4 py-3">
        <p className="text-sm leading-relaxed text-white">{message.text}</p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-100 bg-[#f0fdf9] text-[#0D9488]">
        <BotIcon />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
        <span className="h-2 w-2 animate-bounce rounded-full bg-[#0D9488]" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[#0D9488]" style={{ animationDelay: '150ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[#0D9488]" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

function CukaiBot() {
  const [messages, setMessages] = useState(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeCitations, setActiveCitations] = useState(initialMessages[1].citations);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // // Scroll to bottom when new messages arrive
  // useEffect(() => {
  //   messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  // }, [messages, isTyping]);

  useEffect(() => {
  // Only scroll down automatically if the user has sent new messages
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

    // Simulate assistant response
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

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const showEmptyState = messages.length === 0;

  return (
    <main className="min-h-screen bg-background font-body">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">

        {/* ── Page header (matches ManageAccount / CukaiVault pattern) ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-headings text-3xl font-bold tracking-tight text-headings">CukaiBot</h1>
            <p className="mt-1 text-sm text-[#64748B]">
              Ask anything about Malaysian tax regulations, deductions, or e-invoicing — powered by LHDN 2024 Guidelines.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-white px-3.5 py-2 text-xs font-semibold text-[#64748B] shadow-sm transition-colors hover:bg-slate-50 hover:text-[#0F172A]"
            >
              <ClearIcon />
              Clear Chat
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-white px-3.5 py-2 text-xs font-semibold text-[#64748B] shadow-sm transition-colors hover:bg-slate-50 hover:text-[#0F172A]">
              <DownloadIcon />
              Export
            </button>
          </div>
        </div>

        {/* ── Main two-column layout ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          {/* ── Left: Chat panel (wider) ── */}
          <div className="flex flex-col lg:col-span-2">
            <div className="flex flex-1 flex-col rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden" style={{ minHeight: '600px' }}>

              {/* Chat header */}
              <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0fdf9]">
                  <BotIcon className="h-5 w-5 object-contain" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#0F172A]">Tax Advisory Assistant</p>
                  <p className="text-xs text-[#64748B]">Powered by LHDN 2024 Guidelines</p>
                </div>
              </div>

              {/* Messages area */}
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6" style={{ maxHeight: '460px' }}>

                {/* Empty / welcome state */}
                {showEmptyState && (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f0fdf9]">
                      <BotIcon className="h-9 w-9 object-contain" />
                    </div>
                    <h2 className="text-xl font-bold text-[#0F172A]">How can I assist with your taxes today?</h2>
                    <p className="mt-2 max-w-xs text-sm text-[#64748B]">
                      Ask me anything about Malaysian tax regulations, deductions, or e-invoicing phases.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      {suggestedPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => handleSend(prompt)}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-[#334155] shadow-sm transition-all hover:border-[#0D9488] hover:bg-[#f0fdf9] hover:text-[#0D9488]"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Messages */}
                {messages.map((msg) =>
                  msg.role === 'user'
                    ? <UserMessage key={msg.id} message={msg} />
                    : <AssistantMessage key={msg.id} message={msg} />
                )}

                {isTyping && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>

              {/* Suggested prompts (shown only when there are no messages yet but hidden via conditional above, and also as contextual chips) */}
              {!showEmptyState && (
                <div className="border-t border-slate-50 px-5 py-2.5 flex items-center gap-2 overflow-x-auto scrollbar-none">
                  {suggestedPrompts.slice(0, 3).map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-[#64748B] transition-all hover:border-[#0D9488] hover:bg-[#f0fdf9] hover:text-[#0D9488]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {/* Input bar */}
              <div className="border-t border-slate-100 px-4 py-4">
                <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 transition-all focus-within:border-[#0D9488] focus-within:ring-4 focus-within:ring-[#0D9488]/10">
                  <textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about deductions, regulations, or upload a notice..."
                    rows={1}
                    className="flex-1 resize-none bg-transparent text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none py-2 align-middle"
                    style={{ maxHeight: '96px' }}
                  />
                  <div className="flex shrink-0 items-center gap-1 pb-0.5">
                    <button className="rounded-lg p-1.5 text-[#64748B] transition-colors hover:bg-slate-200">
                      <AttachIcon />
                    </button>
                    <button
                      onClick={() => handleSend()}
                      disabled={!inputValue.trim() || isTyping}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F172A] text-white shadow-sm transition-all hover:bg-[#1E293B] disabled:cursor-not-allowed disabled:opacity-40"
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
          </div>

          {/* ── Right: Citations panel (narrower) ── */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <BookIcon className="text-[#0D9488]" />
                <h2 className="text-sm font-bold text-[#0F172A]">Active Citations</h2>
              </div>
              <p className="mb-4 text-xs text-[#64748B]">Sources referenced in the current response.</p>

              <div className="space-y-3">
                {activeCitations.length > 0
                  ? activeCitations.map((citation, i) => (
                      <CitationCard key={i} citation={citation} />
                    ))
                  : <EmptyCitationsPlaceholder />
                }
              </div>
            </div>

            {/* Disclaimer card */}
            <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
              <p className="text-xs font-semibold text-amber-700">Important Notice</p>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-600">
                CukaiBot provides guidance based on publicly available LHDN regulations. Always consult a licensed tax agent for filing advice specific to your situation.
              </p>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}

export default CukaiBot;