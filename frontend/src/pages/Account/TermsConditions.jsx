import { useState } from 'react';

// ── Section data ───────────────────────────────────────────────────────────────
// Structured as an array (rather than one long block of JSX) so the table of
// contents on the left and the numbered sections in the body are always
// generated from the same source and can never drift out of sync with each
// other as clauses are added, reordered, or renumbered.
const SECTIONS = [
  {
    id: 'acceptance',
    title: '1. Acceptance of These Terms',
    paragraphs: [
      'These Terms and Conditions ("Terms") form a binding agreement between you ("User", "you") and cukai ("cukai", "we", "us", "our") governing your access to and use of the cukai web application and related services (collectively, the "Service"). By creating an account, accessing, or using the Service in any way, you confirm that you have read, understood, and agree to be bound by these Terms and by our handling of your personal data as described in Section 6 (Personal Data Protection).',
      'If you do not agree to these Terms, you must not access or use the Service. If you are using the Service on behalf of a business or other entity, you confirm that you have the authority to bind that entity to these Terms, and "you" refers to both you individually and that entity.',
    ],
  },
  {
    id: 'description',
    title: '2. Description of the Service',
    paragraphs: [
      'cukai is a software tool that helps Malaysian individuals and sole proprietors organise financial documents, estimate tax positions, and identify potential deductions and reliefs under the Income Tax Act 1967, using a combination of automated document processing and artificial intelligence ("AI").',
      'cukai is a supporting tool only. It does not prepare or submit any filing to Lembaga Hasil Dalam Negeri Malaysia ("LHDN") on your behalf, and it is not connected to LHDN\u2019s MyTax system or any other government filing system. You remain solely responsible for reviewing, verifying, and submitting your own tax filings through the proper official channels, or through a licensed tax agent.',
      'cukai is not a law firm, audit firm, or licensed tax agent under the Income Tax Act 1967 or the Tax Agent\u2019s Licence framework administered by LHDN, and no part of the Service constitutes the practice of law, accountancy, or tax agency services.',
    ],
  },
  {
    id: 'eligibility',
    title: '3. Eligibility and Accounts',
    paragraphs: [
      'You must be at least 18 years old and legally capable of entering into a binding contract under Malaysian law to use the Service. The Service is intended for individual taxpayers and sole proprietors and is not directed at minors.',
      'You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You must notify us promptly if you become aware of any unauthorised access to or use of your account.',
      'You agree to provide accurate, current, and complete information when creating your account and maintaining your profile, and to update that information as it changes. Providing false or misleading information may result in suspension or termination of your account.',
    ],
  },
  {
    id: 'ai-disclaimer',
    title: '4. AI-Generated Content and No Professional Advice',
    paragraphs: [
      'The Service uses AI to read, classify, and summarise the documents you upload, and to generate estimates, suggestions, and written explanations ("AI-Generated Content"). AI-Generated Content is produced automatically based on the documents and information you provide and on publicly available tax guidance, and may contain errors, omissions, or misclassifications.',
      'AI-Generated Content is provided for informational and organisational purposes only. It does not constitute legal advice, accounting advice, financial advice, or professional tax advice, and must not be relied upon as a final or authoritative statement of your tax position or obligations.',
      'You are solely responsible for reviewing every figure, classification, and suggestion the Service produces, and for verifying it against the source documents, current LHDN guidance, and, where appropriate, the advice of a licensed tax agent or other qualified professional, before relying on it for any filing, payment, or financial decision.',
      'We do not guarantee the accuracy, completeness, or currency of any AI-Generated Content, and we are not liable for any loss arising from your reliance on it without independent verification.',
    ],
  },
  {
    id: 'user-obligations',
    title: '5. Your Responsibilities',
    paragraphs: [
      'You are responsible for ensuring that every document, figure, and piece of information you upload or enter into the Service is accurate, complete, lawfully obtained, and belongs to you or an entity you are authorised to act for.',
      'You must not use the Service to process another person\u2019s personal data or financial documents unless you have the legal right and, where required, that person\u2019s consent to do so.',
      'You must not use the Service for any unlawful purpose, including to prepare or submit a fraudulent tax filing, to misrepresent your income or expenses, or to evade tax obligations under Malaysian law.',
      'You must not attempt to reverse-engineer, disrupt, or gain unauthorised access to the Service, probe or scan it for vulnerabilities, or use automated means to extract data from it beyond your own account\u2019s ordinary use.',
    ],
  },
  {
    id: 'pdpa',
    title: '6. Personal Data Protection',
    intro: 'We process personal data in accordance with the Personal Data Protection Act 2010 ("PDPA") and this section serves as our Notice and Choice statement under section 7 of the PDPA.',
    subsections: [
      {
        heading: '6.1 What We Collect',
        body: 'We collect the personal data you provide directly, including your name, identification/passport number, tax identification number, date of birth, contact and correspondence details, marital and dependant information, banking details for refund purposes, and the content of any document you upload (which may itself contain personal data, such as vendor details or transaction records). We also collect data generated by your use of the Service, such as your classification corrections, chat messages with Cukai Bot, and general usage activity.',
      },
      {
        heading: '6.2 Purposes of Processing',
        body: 'We process your personal data to: (a) provide, operate, and maintain the Service, including document classification, tax estimation, and the Cukai Bot and Cukai Insights features; (b) verify your identity and maintain your account; (c) respond to your enquiries and provide support; (d) improve and troubleshoot the Service; and (e) comply with our own legal and regulatory obligations. We do not process your personal data for direct marketing without your separate consent.',
      },
      {
        heading: '6.3 Disclosure of Your Data',
        body: 'We do not sell your personal data. We may disclose personal data to third-party service providers who process it on our behalf and under our instructions \u2014 for example, cloud hosting providers and the AI model providers used to power document classification and Cukai Bot \u2014 strictly to the extent necessary to provide the Service. We require these providers to protect your data to a standard consistent with the PDPA. We may also disclose personal data where required by law, regulation, or a valid order of a Malaysian court or authority, including LHDN where compelled by law.',
      },
      {
        heading: '6.4 Cross-Border Transfers',
        body: 'Some of our service providers, including AI model providers, may process data on servers located outside Malaysia. Where this occurs, we take steps to ensure a comparable standard of protection is applied, consistent with section 129 of the PDPA.',
      },
      {
        heading: '6.5 Retention',
        body: 'We retain your personal data for as long as your account remains active, and for a reasonable period afterward to comply with applicable tax, accounting, and legal record-keeping obligations (which under Malaysian tax law can require retaining records for seven years), or to resolve disputes. You may request deletion of your account and associated data at any time, subject to these retention obligations.',
      },
      {
        heading: '6.6 Security',
        body: 'We apply reasonable technical and organisational measures \u2014 including encryption in transit and access controls \u2014 to protect your personal data against loss, misuse, and unauthorised access or disclosure, as required by the Security Principle of the PDPA. No system can be guaranteed completely secure, and you should also take reasonable steps to protect your own account credentials.',
      },
      {
        heading: '6.7 Your Rights',
        body: 'Under the PDPA, you have the right to: request access to the personal data we hold about you; request correction of inaccurate or incomplete data; withdraw consent to our processing of your data (which may limit or prevent your use of the Service); and lodge a complaint with us or with the Personal Data Protection Commissioner if you believe your data has been mishandled. To exercise any of these rights, contact us using the details in Section 15.',
      },
    ],
  },
  {
    id: 'intellectual-property',
    title: '7. Intellectual Property',
    paragraphs: [
      'The Service, including its software, design, text, graphics, and underlying technology, is owned by or licensed to cukai and is protected by Malaysian and international intellectual property laws. These Terms do not grant you any ownership interest in the Service.',
      'You retain ownership of the documents and data you upload. By uploading content, you grant us a limited, non-exclusive licence to process, store, and display that content solely for the purpose of providing the Service to you.',
    ],
  },
  {
    id: 'liability',
    title: '8. Disclaimers and Limitation of Liability',
    paragraphs: [
      'To the maximum extent permitted by applicable Malaysian law, the Service is provided "as is" and "as available", without warranties of any kind, whether express or implied, including any warranty of accuracy, merchantability, fitness for a particular purpose, or non-infringement.',
      'To the maximum extent permitted by applicable law, cukai and its officers, employees, and service providers will not be liable for any indirect, incidental, special, or consequential loss, or for any penalty, surcharge, or additional tax liability arising from an incorrect, late, or omitted filing, arising out of or in connection with your use of the Service.',
      'Nothing in these Terms excludes or limits any liability that cannot lawfully be excluded or limited under Malaysian law, including liability for death or personal injury caused by negligence, or for fraud or fraudulent misrepresentation.',
    ],
  },
  {
    id: 'indemnity',
    title: '9. Indemnification',
    paragraphs: [
      'You agree to indemnify and hold cukai harmless from any claim, loss, or expense (including reasonable legal fees) arising from your breach of these Terms, your misuse of the Service, or your submission of inaccurate, unlawful, or unauthorised information or documents.',
    ],
  },
  {
    id: 'suspension',
    title: '10. Suspension and Termination',
    paragraphs: [
      'We may suspend or terminate your access to the Service, in whole or in part, at any time if we reasonably believe you have breached these Terms, engaged in unlawful activity, or posed a risk to the security or integrity of the Service. Where practicable, we will provide notice before doing so.',
      'You may stop using the Service and request deletion of your account at any time, subject to Section 6.5 (Retention).',
    ],
  },
  {
    id: 'changes',
    title: '11. Changes to the Service and These Terms',
    paragraphs: [
      'We may update, modify, or discontinue any part of the Service at any time. We may also revise these Terms from time to time to reflect changes in the Service, in applicable law (including updated LHDN guidance or amendments to the PDPA), or in our practices. Where changes are material, we will make reasonable efforts to notify you. Your continued use of the Service after a revised version takes effect constitutes acceptance of the updated Terms.',
    ],
  },
  {
    id: 'governing-law',
    title: '12. Governing Law and Disputes',
    paragraphs: [
      'These Terms are governed by the laws of Malaysia. Any dispute arising out of or in connection with these Terms or the Service will be subject to the exclusive jurisdiction of the courts of Malaysia, without prejudice to any mandatory consumer protection rights you may have.',
    ],
  },
  {
    id: 'general',
    title: '13. General Provisions',
    paragraphs: [
      'If any provision of these Terms is found to be unenforceable or invalid under applicable law, that provision will be limited or eliminated to the minimum extent necessary, and the remaining provisions will remain in full force and effect.',
      'These Terms, together with any policies referenced in them, constitute the entire agreement between you and cukai regarding the Service, and supersede any prior agreements on the same subject matter.',
    ],
  },
  {
    id: 'contact',
    title: '14. Contact Us',
    paragraphs: [
      'If you have questions about these Terms, or wish to exercise any of your rights under Section 6 (Personal Data Protection), please contact us through the support channel designated in your account or on our website.',
    ],
  },
];

// ── Main Component ─────────────────────────────────────────────────────────────
function TermsConditions() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        {/* ── Page Header ── */}
        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Terms & Conditions</h1>
          <p className="text-xs text-muted mt-1">
            Please read these terms carefully before using cukai. They govern your access to and use of our services, including how we collect, use, and protect your personal data under Malaysia's Personal Data Protection Act 2010.
          </p>
        </div>

        {/* ── Split layout: table of contents + scrollable body ── */}
        <div className="flex flex-1 gap-5 min-h-0">

          {/* Table of contents */}
          <aside className="hidden w-56 shrink-0 lg:flex lg:flex-col h-full overflow-y-auto pr-1">
            <nav className="space-y-0.5">
              {SECTIONS.map((sec) => {
                // sec.title is stored as "N. Label" (e.g. "1. Acceptance of
                // These Terms") so the numbered body headings and this TOC
                // stay in sync. Split it here so the number renders as its
                // own small chip instead of plain leading text — otherwise
                // it visually blends into the label, and a wrapped second
                // line has nothing to hang-indent under.
                const match = sec.title.match(/^(\d+)\.\s*(.*)$/);
                const number = match ? match[1] : null;
                const label = match ? match[2] : sec.title;
                const active = activeId === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => {
                      setActiveId(sec.id);
                      document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                      active
                        ? 'bg-headings font-semibold text-white'
                        : 'text-muted hover:bg-primary-tint hover:text-primary'
                    }`}
                  >
                    {number && (
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          active ? 'bg-white/20 text-white' : 'bg-primary-tint text-primary'
                        }`}
                      >
                        {number}
                      </span>
                    )}
                    <span className="leading-snug">{label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* ── Terms Content ── */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <section className="rounded-xl border border-border bg-surface p-6">
              <p className="mb-6 text-xs text-muted">Last updated: 23 July 2026</p>

              <div className="space-y-8 text-sm leading-relaxed text-[#334155]">
                {SECTIONS.map((sec) => (
                  <div
                    key={sec.id}
                    id={sec.id}
                    onMouseEnter={() => setActiveId(sec.id)}
                    className="scroll-mt-4 space-y-3"
                  >
                    <h2 className="font-headings text-base font-bold text-headings">{sec.title}</h2>

                    {sec.intro && (
                      <p className="italic text-muted">{sec.intro}</p>
                    )}

                    {sec.paragraphs && sec.paragraphs.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}

                    {sec.subsections && (
                      <div className="space-y-4">
                        {sec.subsections.map((sub, i) => (
                          <div key={i}>
                            <h3 className="mb-1 text-sm font-bold text-headings">{sub.heading}</h3>
                            <p>{sub.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

      </div>
    </main>
  );
}

export default TermsConditions;