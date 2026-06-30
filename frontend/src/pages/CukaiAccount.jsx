import { useRef, useState, useCallback, useEffect } from 'react';
import { getEntityById } from '../services/api';
import cukaiLogo from '../assets/cukai-logo.png';

// ─── Design tokens (matches ManageAccount + UserNavigation) ───────────────────
// Primary teal: #0F6E56  Active: #0D9488  Text: #0F172A  Muted: #64748B  Border: #E2E8F0

// ─── User scenarios ───────────────────────────────────────────────────────────
const USER_SCENARIOS = {
  A: {
    label: 'Sole Proprietor', description: 'You operate as a sole proprietor.',
    canViewFormP: false, canFileFormP: false, canFileFormB: true, firm: null,
  },
  B: {
    label: 'Principal Partner', description: 'You are the principal partner of Meridian Print Studio.',
    canViewFormP: true, canFileFormP: true, canFileFormB: true,
    firm: { name: 'Meridian Print Studio', msic: '1811', type: 'Partnership', share: '50%' },
  },
  C: {
    label: 'Partner (Non-Principal)', description: 'You are a partner of Meridian Print Studio, but not the principal partner.',
    canViewFormP: true, canFileFormP: false, canFileFormB: true,
    firm: { name: 'Meridian Print Studio', msic: '1811', type: 'Partnership', share: '30%' },
  },
};

// ─── OCR status meta ──────────────────────────────────────────────────────────
const STATUS_META = {
  deductible:     { label: 'Company Expense', color: '#0F6E56', bg: '#ECFDF5', dot: '#0F6E56' },
  non_deductible: { label: 'Personal Expense', color: '#DC2626', bg: '#FEF2F2', dot: '#DC2626' },
  mixed:          { label: 'Needs Review',     color: '#B45309', bg: '#FFFBEB', dot: '#F59E0B' },
};

// ─── Refined categories ────────────────────────────────────────────────────────
// Business categories follow LHDN "allowable wholly & exclusively for business" types
// (salaries, rental, utilities, professional fees, capital-asset purchases, marketing,
// transport, supplier costs, financing costs). Personal categories cover common
// "domestic and private" non-allowable spend so users see real diversification.
const BUSINESS_CATEGORIES = [
  'Profit & Loss',
  'Balance Sheet',
  'Sales & Service Income',
  'Supplier & Inventory Purchases',
  'Payroll & EPF/SOCSO',
  'Rental & Utilities',
  'Marketing & Advertising',
  'Professional & Legal Fees',
  'Transport & Logistics',
  'Capital Assets & Equipment',
  'Loan Interest & Bank Charges',
  'Office & Admin Supplies',
];
const PERSONAL_CATEGORIES = [
  'Groceries & Household',
  'Personal Travel & Leisure',
  'Dining & Entertainment',
  'Personal Shopping',
  'Medical & Healthcare',
  'Family & Education',
  'Subscriptions & Lifestyle',
];
const REVIEW_CATEGORY = 'Mixed / Pending Review';

const CATEGORY_COLORS = {
  'Profit & Loss': '#001f73',
  'Balance Sheet': '#081f49',
  'Sales & Service Income': '#0F6E56',
  'Supplier & Inventory Purchases': '#0D9488',
  'Payroll & EPF/SOCSO': '#14B8A6',
  'Rental & Utilities': '#10B981',
  'Marketing & Advertising': '#B45309',
  'Professional & Legal Fees': '#64748B',
  'Transport & Logistics': '#7C839B',
  'Capital Assets & Equipment': '#0369A1',
  'Loan Interest & Bank Charges': '#475569',
  'Office & Admin Supplies': '#1D9E75',
  'Groceries & Household': '#DC2626',
  'Personal Travel & Leisure': '#E11D48',
  'Dining & Entertainment': '#F97316',
  'Personal Shopping': '#DB2777',
  'Medical & Healthcare': '#341313',
  'Family & Education': '#F43F5E',
  'Subscriptions & Lifestyle': '#FB7185',
  [REVIEW_CATEGORY]: '#F59E0B',
};

// ─── Initial mock documents ───────────────────────────────────────────────────
// `reason` / `question` / `source` are only meaningful for status === 'mixed':
// they power the enriched reclassify modal so the user understands *why* the AI
// could not decide, and what to check before answering.
//
// `fileType` drives the preview renderer: 'pdf' and 'image' both render as a
// genuine canvas-drawn document (real bitmap, not a placeholder skeleton) built
// from `vendor` / `vendorAddr` / `docNo` / `lineItems`; 'excel' renders as a real
// parsed spreadsheet table from `sheetRows`. Records span 2020–2026 so the new
// year filter has real range to work with (LHDN requires ~7 years of retention).
const INITIAL_DOCS = [
  { id: 1, name: 'Invoice_May2026_001.pdf', type: 'Invoice', fileType: 'pdf', date: '12 May 2026', amount: 'RM 38,400', status: 'deductible', category: 'Sales & Service Income', note: 'Client invoice for design retainer.',
    vendor: 'Meridian Print Studio', vendorAddr: 'Lot 5, Jalan Industri 2, 40000 Shah Alam, Selangor', docNo: 'INV-2026-0512', accent: '#0F6E56', confidence: 96,
    lineItems: [{ desc: 'Brand identity design retainer — May 2026', amt: 8400.00 }] },
  { id: 2, name: 'Receipt_Utilities_Apr2026.pdf', type: 'Utility Bill', fileType: 'pdf', date: '30 Apr 2026', amount: 'RM 1,240', status: 'deductible', category: 'Rental & Utilities', note: 'TNB electricity bill — office premise.',
    vendor: 'Tenaga Nasional Berhad', vendorAddr: 'No. 129, Jalan Bangsar, 59200 Kuala Lumpur', docNo: 'TNB-44210982', accent: '#10B981', confidence: 98,
    lineItems: [{ desc: 'Electricity usage — March 2026 (Account 220011239)', amt: 1240.00 }] },
  { id: 3, name: 'Staff_Salary_Voucher_May.pdf', type: 'Payroll', fileType: 'pdf', date: '31 May 2026', amount: 'RM 14,500', status: 'deductible', category: 'Payroll & EPF/SOCSO', note: 'Monthly salary disbursement.',
    vendor: 'Meridian Print Studio', vendorAddr: 'Lot 5, Jalan Industri 2, 40000 Shah Alam, Selangor', docNo: 'PAY-2026-05', accent: '#14B8A6', confidence: 94,
    lineItems: [{ desc: 'Salary disbursement — 4 staff, May 2026', amt: 14500.00 }] },
  { id: 4, name: 'Directors_Dinner_Receipt.pdf', type: 'Receipt', fileType: 'pdf', date: '18 May 2026', amount: 'RM 980', status: 'mixed', category: REVIEW_CATEGORY,
    note: 'Entertainment — AI uncertain if business-related.',
    reason: 'LHDN treats client entertainment as only partially allowable, and purely social entertainment as non-allowable. The receipt alone doesn\u2019t show who attended or the business purpose of the meal.',
    question: 'Was this dinner held with a client or business contact to discuss work, or was it a personal or social occasion?',
    source: 'LHDN Public Ruling — entertainment expense restriction',
    vendor: 'Sate Kajang Hj Samuri', vendorAddr: 'Jalan Reko, 43000 Kajang, Selangor', docNo: 'RCPT-88231', accent: '#F59E0B',
    lineItems: [{ desc: 'Dinner for 6 pax — set menu', amt: 780.00 }, { desc: 'Beverages', amt: 200.00 }] },
  { id: 5, name: 'Printer_Ink_Supplies.pdf', type: 'Purchase Order', fileType: 'pdf', date: '5 Jun 2026', amount: 'RM 430', status: 'deductible', category: 'Office & Admin Supplies', note: 'Office consumables for print studio.',
    vendor: 'OfficeMart Sdn Bhd', vendorAddr: 'No. 3, Jalan SS15/4, 47500 Subang Jaya, Selangor', docNo: 'PO-55102', accent: '#1D9E75', confidence: 91,
    lineItems: [{ desc: 'HP 678 ink cartridge (black) x4', amt: 220.00 }, { desc: 'A4 paper ream x10', amt: 210.00 }] },
  { id: 6, name: 'Personal_Gym_Membership.jpg', type: 'Receipt', fileType: 'image', date: '1 Jun 2026', amount: 'RM 200', status: 'non_deductible', category: 'Subscriptions & Lifestyle', note: 'Personal gym membership — not business related.',
    vendor: 'FitZone Wellness Club', vendorAddr: 'No. 22, Jalan PJU 7/2, 47800 Petaling Jaya', docNo: 'FZ-MB-66021', accent: '#DC2626', confidence: 88,
    lineItems: [{ desc: 'Monthly membership — June 2026', amt: 200.00 }] },
  { id: 7, name: 'Marketing_Campaign_May.pdf', type: 'Invoice', fileType: 'pdf', date: '20 May 2026', amount: 'RM 3,200', status: 'deductible', category: 'Marketing & Advertising', note: 'Social media advertising spend.',
    vendor: 'AdReach Digital Agency', vendorAddr: 'Level 12, Menara KL, Jalan Sultan Ismail, 50250 Kuala Lumpur', docNo: 'AD-2026-0520', accent: '#B45309', confidence: 90,
    lineItems: [{ desc: 'Instagram + Facebook ad campaign — May 2026', amt: 3200.00 }] },
  { id: 8, name: 'Grab_Business_Trips.jpg', type: 'Receipt', fileType: 'image', date: '28 May 2026', amount: 'RM 340', status: 'deductible', category: 'Transport & Logistics', note: 'Client meeting transport.',
    vendor: 'Grab Malaysia', vendorAddr: 'E-Receipt — In-app', docNo: 'GRB-TX-885214', accent: '#0F6E56', confidence: 93,
    lineItems: [{ desc: 'Trip: Office to client site (3 trips)', amt: 340.00 }] },
  { id: 9, name: 'Personal_Holiday_Flight.jpg', type: 'Receipt', fileType: 'image', date: '15 Jun 2026', amount: 'RM 1,800', status: 'non_deductible', category: 'Personal Travel & Leisure', note: 'Family holiday flights — personal.',
    vendor: 'AirAsia Berhad', vendorAddr: 'KLIA2, 64000 Sepang, Selangor', docNo: 'AK-BOOK-991122', accent: '#DC2626', confidence: 95,
    lineItems: [{ desc: 'KUL-DPS return x2 — economy', amt: 1800.00 }] },
  { id: 10, name: 'Team_Lunch_Receipt.jpg', type: 'Receipt', fileType: 'image', date: '10 Jun 2026', amount: 'RM 560', status: 'mixed', category: REVIEW_CATEGORY,
    note: 'Team lunch — may be partially deductible.',
    reason: 'Staff meals are allowable when tied to a specific work event (e.g. project milestone, overtime), but routine team lunches without a documented business reason are typically treated as private expenditure.',
    question: 'Was this lunch connected to a specific work event or deliverable, or was it a regular team meal with no particular business occasion?',
    source: 'LHDN Public Ruling — staff welfare vs. entertainment expenses',
    vendor: 'Nasi Kandar Pelita', vendorAddr: 'Jalan Ampang, 50450 Kuala Lumpur', docNo: 'PEL-77234', accent: '#F59E0B',
    lineItems: [{ desc: 'Set lunch x6', amt: 360.00 }, { desc: 'Teh tarik x6', amt: 60.00 }, { desc: 'Add-on dishes', amt: 140.00 }] },
  { id: 11, name: 'New_Laptop_Purchase.pdf', type: 'Invoice', fileType: 'pdf', date: '3 Jun 2026', amount: 'RM 5,200', status: 'deductible', category: 'Capital Assets & Equipment', note: 'MacBook Pro for design work — capital allowance eligible.',
    vendor: 'Switch by Switzz Sdn Bhd', vendorAddr: 'Lot G-12, Pavilion KL, 55100 Kuala Lumpur', docNo: 'INV-APL-9921', accent: '#0369A1', confidence: 92,
    lineItems: [{ desc: 'Apple MacBook Pro 14" M3 Pro 18GB/512GB', amt: 5200.00 }] },
  { id: 12, name: 'Legal_Retainer_Q2.pdf', type: 'Invoice', fileType: 'pdf', date: '22 May 2026', amount: 'RM 2,500', status: 'deductible', category: 'Professional & Legal Fees', note: 'Quarterly legal retainer for contracts.',
    vendor: 'Wong & Partners Advocates', vendorAddr: 'Suite 21-01, Menara Hap Seng, 50450 Kuala Lumpur', docNo: 'LGL-Q2-2026', accent: '#64748B', confidence: 89,
    lineItems: [{ desc: 'Quarterly legal retainer — Q2 2026', amt: 2500.00 }] },
  { id: 13, name: 'Business_Loan_Interest_Statement.xlsx', type: 'Bank Statement', fileType: 'excel', date: '1 Jun 2026', amount: 'RM 670', status: 'deductible', category: 'Loan Interest & Bank Charges', note: 'Monthly interest on business equipment loan.',
    vendor: 'Maybank Islamic Berhad', vendorAddr: 'Menara Maybank, 100 Jalan Tun Perak, 50050 Kuala Lumpur', docNo: 'STMT-6620124', accent: '#475569', confidence: 97,
    sheetRows: [
      ['Date', 'Description', 'Type', 'Amount (RM)'],
      ['01 Jan 2026', 'Equipment financing — interest charged', 'Interest', '640.00'],
      ['01 Feb 2026', 'Equipment financing — interest charged', 'Interest', '655.00'],
      ['01 Mar 2026', 'Equipment financing — interest charged', 'Interest', '648.00'],
      ['01 Apr 2026', 'Equipment financing — interest charged', 'Interest', '660.00'],
      ['01 May 2026', 'Equipment financing — interest charged', 'Interest', '665.00'],
      ['01 Jun 2026', 'Equipment financing — interest charged', 'Interest', '670.00'],
    ] },
  { id: 14, name: 'Weekly_Groceries.jpg', type: 'Receipt', fileType: 'image', date: '8 Jun 2026', amount: 'RM 310', status: 'non_deductible', category: 'Groceries & Household', note: 'Household groceries — personal.',
    vendor: 'Village Grocer', vendorAddr: 'Bangsar Village II, 59100 Kuala Lumpur', docNo: 'VG-441029', accent: '#DC2626', confidence: 87,
    lineItems: [{ desc: 'Fresh produce', amt: 96.50 }, { desc: 'Pantry items', amt: 113.80 }, { desc: 'Household supplies', amt: 99.70 }] },
  { id: 15, name: 'Kids_Tuition_Fee.pdf', type: 'Receipt', fileType: 'pdf', date: '2 Jun 2026', amount: 'RM 450', status: 'non_deductible', category: 'Family & Education', note: 'Children tuition — personal expense.',
    vendor: 'Genius Kids Tuition Centre', vendorAddr: 'No. 8, Jalan SS2/24, 47300 Petaling Jaya, Selangor', docNo: 'TUI-2026-0602', accent: '#F43F5E', confidence: 90,
    lineItems: [{ desc: 'Tuition fees — June 2026 (2 children)', amt: 450.00 }] },
  { id: 16, name: 'Office_Chair_Purchase.pdf', type: 'Invoice', fileType: 'pdf', date: '14 Jun 2026', amount: 'RM 890', status: 'mixed', category: REVIEW_CATEGORY,
    note: 'Furniture purchase — AI cannot confirm where this item is used.',
    reason: 'Furniture is only an allowable capital expense when used wholly and exclusively for business, such as in a registered office or dedicated workspace. The same item bought for a home living area would be treated as a private, non-allowable cost.',
    question: 'Is this chair used at your registered business premise or a dedicated home office, or is it for general home use?',
    source: 'LHDN Public Ruling — wholly & exclusively business-use test',
    vendor: 'ErgoHome Furnishing', vendorAddr: 'No. 45, Jalan Klang Lama, 58000 Kuala Lumpur', docNo: 'INV-EH-3321', accent: '#F59E0B',
    lineItems: [{ desc: 'Ergonomic mesh office chair — Model ER-220', amt: 890.00 }] },
  // Prior-year archive records, to give the new year filter real range to work with.
  { id: 17, name: 'Invoice_Dec2025_088.pdf', type: 'Invoice', fileType: 'pdf', date: '14 May 2025', amount: 'RM 36,150', status: 'deductible', category: 'Sales & Service Income', note: 'Year-end client invoice.',
    vendor: 'Meridian Print Studio', vendorAddr: 'Lot 5, Jalan Industri 2, 40000 Shah Alam, Selangor', docNo: 'INV-2025-1214', accent: '#0F6E56', confidence: 85,
    lineItems: [{ desc: 'Annual report design and print — Dec 2025', amt: 6150.00 }] },
  { id: 18, name: 'Receipt_Utilities_Mar2025.pdf', type: 'Utility Bill', fileType: 'pdf', date: '28 Mar 2025', amount: 'RM 980', status: 'deductible', category: 'Rental & Utilities', note: 'TNB electricity bill — office premise.',
    vendor: 'Tenaga Nasional Berhad', vendorAddr: 'No. 129, Jalan Bangsar, 59200 Kuala Lumpur', docNo: 'TNB-31202571', accent: '#10B981', confidence: 93,
    lineItems: [{ desc: 'Electricity usage — February 2025', amt: 980.00 }] },
  { id: 19, name: 'Office_Renovation_Sept2025.pdf', type: 'Invoice', fileType: 'pdf', date: '9 Sep 2025', amount: 'RM 12,400', status: 'deductible', category: 'Capital Assets & Equipment', note: 'Office renovation — capital improvement.',
    vendor: 'BuildRight Renovations', vendorAddr: 'No. 17, Jalan Industri 4, 40000 Shah Alam, Selangor', docNo: 'BR-2025-0909', accent: '#0369A1', confidence: 78,
    lineItems: [{ desc: 'Office partition and flooring works', amt: 9400.00 }, { desc: 'Electrical rewiring', amt: 3000.00 }] },
  { id: 20, name: 'Family_Medical_Bill_2025.jpg', type: 'Receipt', fileType: 'image', date: '3 Mar 2025', amount: 'RM 1,250', status: 'non_deductible', category: 'Medical & Healthcare', note: 'Family medical expenses — personal.',
    vendor: 'Pantai Hospital', vendorAddr: 'Jalan Bukit Pantai, 59100 Kuala Lumpur', docNo: 'PH-OPD-25301', accent: '#DC2626', confidence: 91,
    lineItems: [{ desc: 'Outpatient consultation and medication', amt: 1250.00 }] },
  { id: 21, name: 'Supplier_Paper_Stock_2025.pdf', type: 'Purchase Order', fileType: 'pdf', date: '19 Jul 2025', amount: 'RM 4,820', status: 'deductible', category: 'Supplier & Inventory Purchases', note: 'Bulk paper stock for print jobs.',
    vendor: 'PaperWorks Trading Sdn Bhd', vendorAddr: 'No. 8, Jalan Perusahaan 2, 47100 Puchong, Selangor', docNo: 'PO-2025-3381', accent: '#0D9488', confidence: 89,
    lineItems: [{ desc: 'A3 art paper stock — 200 reams', amt: 4820.00 }] },
  { id: 22, name: 'Annual_Insurance_Premium_2025.pdf', type: 'Invoice', fileType: 'pdf', date: '11 Feb 2025', amount: 'RM 2,160', status: 'mixed', category: REVIEW_CATEGORY,
    note: 'Insurance premium — AI cannot confirm whether this covers business assets, personal assets, or both.',
    reason: 'The policy schedule was not detected on this document. Combined business-and-personal insurance bundles are only partially allowable, and the deductible portion depends on what the policy actually covers.',
    question: 'Does this insurance policy cover business assets and liability, personal assets, or a combination of both?',
    source: 'LHDN Public Ruling — apportionment of mixed-use expenses',
    vendor: 'Allianz General Insurance Malaysia', vendorAddr: 'Level 29, Menara Allianz Sentral, 50470 Kuala Lumpur', docNo: 'ALZ-2025-0211', accent: '#F59E0B', confidence: 94,
    lineItems: [{ desc: 'Annual combined business & home insurance premium', amt: 2160.00 }] },
  { id: 23, name: 'Office_Rent_Jan2025.pdf', type: 'Invoice', fileType: 'pdf', date: '2 Jan 2025', amount: 'RM 4,500', status: 'deductible', category: 'Rental & Utilities', note: 'Monthly office rental expense.',
    vendor: 'UOA Property Management', vendorAddr: 'Level 5, Bangsar South, 59200 Kuala Lumpur', docNo: 'INV-UOA-2025-001', accent: '#1E3A8A', confidence: 98,
    lineItems: [{ desc: 'Office lot 12-B rental fee — January 2025', amt: 4500.00 }] },
  { id: 24, name: 'Web_Hosting_Annual_2025.pdf', type: 'Receipt', fileType: 'pdf', date: '15 Mar 2025', amount: 'RM 1,280', status: 'deductible', category: 'Office & Admin Supplies', note: 'Annual cloud infrastructure and domain renewal.',
    vendor: 'Exabytes Malaysia', vendorAddr: '1-18-8, Suntech Penang Cybercity, 11900 Bayan Lepas, Penang', docNo: 'EXA-992812', accent: '#4F46E5', confidence: 95,
    lineItems: [{ desc: 'Business VPS Hosting Renewal — 12 Months', amt: 1200.00 }, { desc: '.com domain maintenance fee', amt: 80.00 }] },
  { id: 25, name: 'Company_Trip_Dinner_2025.jpg', type: 'Receipt', fileType: 'image', date: '24 May 2025', amount: 'RM 850', status: 'deductible', category: 'Entertainment & Meals', note: 'Staff annual dinner appreciation meal.',
    vendor: 'Bijan Bar & Restaurant', vendorAddr: '3, Jalan Ceylon, 50200 Kuala Lumpur', docNo: 'BIJ-77192', accent: '#B45309', confidence: 88,
    lineItems: [{ desc: 'Corporate dinner set menu x10', amt: 850.00 }] },
  { id: 26, name: 'Client_Gift_Hampers_2025.pdf', type: 'Invoice', fileType: 'pdf', date: '18 Jun 2025', amount: 'RM 1,500', status: 'mixed', category: REVIEW_CATEGORY,
    note: 'Festive gifts for long-term clients.',
    reason: 'Entertainment expenses targeting clients are generally only 50% deductible under Section 39(1)(l) of the Income Tax Act 1967.',
    question: 'Were these corporate gifts distributed universally as promotional items, or sent exclusively to specific key accounts?',
    source: 'Public Ruling No. 4/2015 — Entertainment Expenses',
    vendor: 'Pods & Petals Giftlab', vendorAddr: 'Jalan SS 22/25, Damansara Jaya, 47400 Petaling Jaya, Selangor', docNo: 'GFT-2025-0618', accent: '#F59E0B', confidence: 92,
    lineItems: [{ desc: 'Premium Festive Gift Hampers x5', amt: 1500.00 }] },
  { id: 27, name: 'New_Staff_Laptop_2025.pdf', type: 'Invoice', fileType: 'pdf', date: '12 Aug 2025', amount: 'RM 3,899', status: 'deductible', category: 'Capital Assets & Equipment', note: 'Workstation asset for new graphic designer.',
    vendor: 'SNS Network Sdn Bhd', vendorAddr: '61, Jalan Sultan Nazrin Shah, 30250 Ipoh, Perak', docNo: 'SNS-INV-55410', accent: '#0369A1', confidence: 97,
    lineItems: [{ desc: 'ASUS Vivobook Pro 15 OLED', amt: 3899.00 }] },
  { id: 28, name: 'Personal_Gym_Membership_2025.jpg', type: 'Receipt', fileType: 'image', date: '5 Sep 2025', amount: 'RM 240', status: 'non_deductible', category: 'Personal Subscriptions', note: "Director's personal gym monthly dues.",
    vendor: 'Celebrity Fitness Malaysia', vendorAddr: 'Mid Valley Megamall, Lingkaran Syed Putra, 59200 Kuala Lumpur', docNo: 'CF-883192', accent: '#DC2626', confidence: 94,
    lineItems: [{ desc: 'Monthly Premier Membership Fee', amt: 240.00 }] },
  { id: 29, name: 'Legal_Consultation_IP_2025.pdf', type: 'Invoice', fileType: 'pdf', date: '14 Oct 2025', amount: 'RM 3,500', status: 'deductible', category: 'Professional & Legal Fees', note: 'Trademark registration legal services.',
    vendor: 'Zaid Ibrahim & Co', vendorAddr: 'Level 19, Menara Milenium, Damansara Heights, 50490 Kuala Lumpur', docNo: 'ZICO-2025-1044', accent: '#6B21A8', confidence: 91,
    lineItems: [{ desc: 'Professional fees for trademark search and filing', amt: 3500.00 }] },
  { id: 30, name: 'AC_Maintenance_Office_2025.pdf', type: 'Receipt', fileType: 'pdf', date: '22 Nov 2025', amount: 'RM 450', status: 'deductible', category: 'Rental & Utilities', note: 'Routine asset repair and upkeep.',
    vendor: 'CoolingMaster Engineering', vendorAddr: 'No. 32, Jalan Impian Emas, 81300 Johor Bahru, Johor', docNo: 'CM-REP-2025-91', accent: '#10B981', confidence: 87,
    lineItems: [{ desc: 'Chemical cleaning and gas top-up — 3x AC units', amt: 450.00 }] },
  { id: 31, name: 'Digital_Ads_Q4_2025.pdf', type: 'Invoice', fileType: 'pdf', date: '5 Dec 2025', amount: 'RM 5,000', status: 'deductible', category: 'Marketing & Advertising', note: 'Paid search engine marketing campaign acceleration.',
    vendor: 'Google Asia Pacific Pte Ltd', vendorAddr: '70 Pasir Panjang Road, #03-71 Mapletree Business City, Singapore 117371', docNo: 'GGL-ADS-881024', accent: '#4338CA', confidence: 96,
    lineItems: [{ desc: 'Google Ads Performance Max Campaign — Nov/Dec 2025', amt: 5000.00 }] },
  { id: 32, name: 'Stationery_Restock_2025.pdf', type: 'Purchase Order', fileType: 'pdf', date: '19 Dec 2025', amount: 'RM 320', status: 'deductible', category: 'Office & Admin Supplies', note: 'Miscellaneous office stationeries.',
    vendor: 'Faber-Castell Malaysia', vendorAddr: '9, Jalan TP2, Taman Perindustrian SIME UEP, 47600 Subang Jaya, Selangor', docNo: 'PO-FC-99102', accent: '#0D9488', confidence: 93,
    lineItems: [{ desc: 'Whiteboard markers, permanent markers, notebooks, binders', amt: 320.00 }] },
  { 
    id: 33, 
    name: 'Meridian_PL_FY2025.xlsx', 
    type: 'Financial Statement', 
    fileType: 'excel', 
    date: '31 Dec 2025', 
    amount: 'RM 349,350', 
    status: 'deductible', 
    category: 'Profit & Loss', 
    note: 'Full-year Profit & Loss statement for FY2025 detailing corporate revenues and operating outlays.',
    vendor: 'Meridian Print Studio Sdn Bhd', 
    vendorAddr: 'Lot 5, Jalan Industri 2, 40000 Shah Alam, Selangor', 
    docNo: 'PL-2025-AUD', 
    accent: '#0F6E56', 
    confidence: 100,
    sheetRows: [
      ['Financial Metric / Item Description', 'Amount (RM)'],
      ['Total Revenue FY2025', 349350.00],
      ['Gross Profit FY2025', 245350.00],
      ['Net Profit After Tax FY2025', 52055.00]
    ]
  },
  { 
    id: 34, 
    name: 'Meridian_PL_FY2026.xlsx', 
    type: 'Financial Statement', 
    fileType: 'excel', 
    date: '31 Dec 2026', 
    amount: 'RM 392,400', 
    status: 'deductible', 
    category: 'Profit & Loss', 
    note: 'Full-year Profit & Loss statement for FY2026 capturing annual business turnover escalation.',
    vendor: 'Meridian Print Studio Sdn Bhd', 
    vendorAddr: 'Lot 5, Jalan Industri 2, 40000 Shah Alam, Selangor', 
    docNo: 'PL-2026-AUD', 
    accent: '#0F6E56', 
    confidence: 100,
    sheetRows: [
      ['Financial Metric / Item Description', 'Amount (RM)'],
      ['Total Revenue FY2026', 392400.00],
      ['Gross Profit FY2026', 274400.00],
      ['Net Profit After Tax FY2026', 60288.00]
    ]
  },
  { 
    id: 35, 
    name: 'Meridian_BS_FY2025.xlsx', 
    type: 'Financial Statement', 
    fileType: 'excel', 
    date: '31 Dec 2025', 
    amount: 'RM 182,420', 
    status: 'deductible', 
    category: 'Balance Sheet', 
    note: 'Corporate Balance Sheet statement mapping fiscal assets, current obligations, and shareholder equity allocations as of year-end 2025.',
    vendor: 'Meridian Print Studio Sdn Bhd', 
    vendorAddr: 'Lot 5, Jalan Industri 2, 40000 Shah Alam, Selangor', 
    docNo: 'BS-2025-AUD', 
    accent: '#0369A1', 
    confidence: 100,
    sheetRows: [
      ['Financial Metric / Item Description', 'Amount (RM)'],
      ['Total Assets (Current & Non-Current)', 182420.00],
      ['Total Liabilities', 85815.00],
      ['Total Shareholders\' Equity', 109205.00]
    ]
  },
  { 
    id: 36, 
    name: 'Meridian_BS_FY2026.xlsx', 
    type: 'Financial Statement', 
    fileType: 'excel', 
    date: '31 Dec 2026', 
    amount: 'RM 226,000', 
    status: 'deductible', 
    category: 'Balance Sheet', 
    note: 'Corporate Balance Sheet statement tracking asset shifts and financing balances through closing period 2026.',
    vendor: 'Meridian Print Studio Sdn Bhd', 
    vendorAddr: 'Lot 5, Jalan Industri 2, 40000 Shah Alam, Selangor', 
    docNo: 'BS-2026-AUD', 
    accent: '#0369A1', 
    confidence: 100,
    sheetRows: [
      ['Financial Metric / Item Description', 'Amount (RM)'],
      ['Total Assets (Current & Non-Current)', 226000.00],
      ['Total Liabilities', 80878.00],
      ['Total Shareholders\' Equity', 150879.00]
    ]
  }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseAmt = (s) => parseFloat((s || '').replace(/[^\d.]/g, '')) || 0;
const fmtRM = (v) => 'RM ' + Number(v).toLocaleString('en-MY', { maximumFractionDigits: 0 });
const pct = (v, total) => total ? ((v / total) * 100).toFixed(1) + '%' : '0%';

function buildBusinessSegments(docs) {
  const totals = {};
  docs.filter(d => d.status === 'deductible').forEach(d => {
    totals[d.category] = (totals[d.category] || 0) + parseAmt(d.amount);
  });
  return Object.entries(totals)
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value, color: CATEGORY_COLORS[label] || '#94A3B8' }))
    .sort((a, b) => b.value - a.value);
}

function buildPersonalSegments(docs) {
  const totals = {};
  docs.filter(d => d.status === 'non_deductible').forEach(d => {
    totals[d.category] = (totals[d.category] || 0) + parseAmt(d.amount);
  });
  return Object.entries(totals)
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value, color: CATEGORY_COLORS[label] || '#94A3B8' }))
    .sort((a, b) => b.value - a.value);
}

function buildTaxSummarySegments(formData) {
  const { chargeableIncome, totalRelief, taxPayable } = formData;
  const segs = [];
  if (chargeableIncome > 0) segs.push({ label: 'Chargeable Income', value: chargeableIncome, color: '#0F6E56' });
  if (totalRelief > 0) segs.push({ label: 'Total Relief Claimed', value: totalRelief, color: '#10B981' });
  if (taxPayable > 0) segs.push({ label: 'Est. Tax Payable', value: taxPayable, color: '#B45309' });
  return segs;
}

// ─── HTML tooltip (portal-free, viewport-clamped) ─────────────────────────────
// Renders as a fixed-position div positioned from the mouse event's clientX/Y,
// then clamps to the viewport so long labels are never cut off by a parent's
// overflow:hidden — unlike an inline SVG <g>, this escapes the SVG's box entirely.
function ChartTooltip({ show, x, y, color, label, value, percent }) {
  if (!show) return null;
  const TW = 180;
  let left = x + 14;
  let top = y - 12;
  if (typeof window !== 'undefined') {
    if (left + TW > window.innerWidth - 8) left = x - TW - 14;
    if (top < 8) top = 8;
    if (top + 70 > window.innerHeight - 8) top = window.innerHeight - 78;
  }
  return (
    <div
      className="fixed z-[9999] pointer-events-none rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 shadow-lg"
      style={{ left, top, width: TW }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
        <span className="text-[10px] font-semibold text-[#0F172A] leading-tight break-words">{label}</span>
      </div>
      <p className="text-[10px] text-[#64748B] mt-1">{value}</p>
      <p className="text-[10px] text-[#94A3B8]">{percent} of total</p>
    </div>
  );
}

// ─── Donut Pie Chart ──────────────────────────────────────────────────────────
function DonutChart({ segments, title, subtitle, size = 140 }) {
  const [hovered, setHovered] = useState(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  const total = segments.reduce((s, sg) => s + sg.value, 0);
  const CX = size / 2, CY = size / 2, R = size * 0.39, INNER = size * 0.22;

  // Build slice paths. Special-case a single full-value segment (would otherwise
  // produce a zero-length arc at exactly 360 degrees and render nothing).
  let slices = [];
  if (total > 0) {
    const nonZero = segments.filter(s => s.value > 0);
    if (nonZero.length === 1) {
      const sg = nonZero[0];
      // Two semicircle arcs = a full ring, since a single 360° arc command is degenerate.
      const outerTop = `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX} ${CY + R} A ${R} ${R} 0 1 1 ${CX} ${CY - R}`;
      const innerTop = `M ${CX} ${CY - INNER} A ${INNER} ${INNER} 0 1 0 ${CX} ${CY + INNER} A ${INNER} ${INNER} 0 1 0 ${CX} ${CY - INNER}`;
      slices = [{ ...sg, d: `${outerTop} Z ${innerTop} Z`, fullCircle: true }];
    } else {
      let cum = -Math.PI / 2;
      slices = nonZero.map(sg => {
        const angle = (sg.value / total) * 2 * Math.PI;
        const start = cum; cum += angle; const end = cum;
        const large = angle > Math.PI ? 1 : 0;
        const x1 = CX + R * Math.cos(start), y1 = CY + R * Math.sin(start);
        const x2 = CX + R * Math.cos(end),   y2 = CY + R * Math.sin(end);
        const ix1 = CX + INNER * Math.cos(start), iy1 = CY + INNER * Math.sin(start);
        const ix2 = CX + INNER * Math.cos(end),   iy2 = CY + INNER * Math.sin(end);
        const d = [`M ${x1} ${y1}`, `A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`,
          `L ${ix2} ${iy2}`, `A ${INNER} ${INNER} 0 ${large} 0 ${ix1} ${iy1}`, 'Z'].join(' ');
        return { ...sg, d };
      });
    }
  }

  const handleMove = (e, sg) => {
    setMouse({ x: e.clientX, y: e.clientY });
    setHovered(sg);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {title && (
        <div className="text-center">
          <p className="text-xs font-semibold text-[#0F172A]">{title}</p>
          {subtitle && <p className="text-[10px] text-[#94A3B8] mt-0.5">{subtitle}</p>}
        </div>
      )}
      {total === 0 ? (
        <div style={{ width: size, height: size }} className="flex items-center justify-center rounded-full border-2 border-dashed border-[#E2E8F0]">
          <p className="text-[9px] text-[#94A3B8] text-center px-2">No data yet</p>
        </div>
      ) : (
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
            onMouseLeave={() => setHovered(null)} style={{ overflow: 'visible' }}>
            {slices.map((sl) => (
              <path key={sl.label} d={sl.d} fill={sl.color} fillRule="evenodd"
                opacity={hovered && hovered.label !== sl.label ? 0.4 : 1}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s, transform 0.1s', transformOrigin: `${CX}px ${CY}px`,
                  transform: hovered?.label === sl.label ? 'scale(1.04)' : 'scale(1)' }}
                onMouseEnter={(e) => handleMove(e, sl)}
                onMouseMove={(e) => handleMove(e, sl)} />
            ))}
            <text x={CX} y={CY - 5} textAnchor="middle" fontSize={size * 0.07} fill="#94A3B8" fontFamily="sans-serif">total</text>
            <text x={CX} y={CY + 8} textAnchor="middle" fontSize={size * 0.075} fill="#0F172A" fontWeight="700" fontFamily="sans-serif">
              {fmtRM(total)}
            </text>
          </svg>
          {/* HTML tooltip — escapes SVG bounds, viewport-clamped, never clipped */}
          <ChartTooltip
            show={!!hovered}
            x={mouse.x} y={mouse.y}
            color={hovered?.color} label={hovered?.label}
            value={hovered ? fmtRM(hovered.value) : ''}
            percent={hovered ? pct(hovered.value, total) : ''}
          />
        </div>
      )}
      {/* Legend */}
      <div className="w-full space-y-1.5">
        {slices.map(sl => (
          <div key={sl.label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: sl.color }} />
              <span className="truncate text-[10px] text-[#64748B]">{sl.label}</span>
            </div>
            <span className="text-[10px] font-semibold text-[#0F172A] shrink-0">{pct(sl.value, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Persistent triple-chart sidebar (shown on all tabs) ──────────────────────
function ChartSidebar({ docs, formData }) {
  const bizSegs   = buildBusinessSegments(docs);
  const persSegs  = buildPersonalSegments(docs);
  const taxSegs   = buildTaxSummarySegments(formData);
  const totalBiz  = bizSegs.reduce((s, sg) => s + sg.value, 0);
  const totalPers = persSegs.reduce((s, sg) => s + sg.value, 0);

  return (
    <div className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto">
      {/* Business chart card */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <DonutChart segments={bizSegs} title="Business Expenses" subtitle="Company-classified items" size={130} />
        <div className="mt-3 border-t border-[#F1F5F9] pt-2.5 flex justify-between items-center">
          <span className="text-[10px] text-[#64748B]">Deductible total</span>
          <span className="text-[10px] font-bold text-[#0F6E56]">{fmtRM(totalBiz)}</span>
        </div>
      </div>
      {/* Personal chart card */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <DonutChart segments={persSegs} title="Personal Expenses" subtitle="Non-deductible items" size={130} />
        <div className="mt-3 border-t border-[#F1F5F9] pt-2.5 flex justify-between items-center">
          <span className="text-[10px] text-[#64748B]">Non-deductible</span>
          <span className="text-[10px] font-bold text-[#DC2626]">{fmtRM(totalPers)}</span>
        </div>
      </div>
      {/* Tax summary chart card */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-4">
        <DonutChart segments={taxSegs} title="Tax Summary" subtitle="From Generate Report" size={130} />
        <div className="mt-3 border-t border-[#F1F5F9] pt-2.5 flex justify-between items-center">
          <span className="text-[10px] text-[#64748B]">Est. payable</span>
          <span className="text-[10px] font-bold text-[#B45309]">{fmtRM(formData.taxPayable)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Tab navigation ───────────────────────────────────────────────────────────
function CukaiTabNav({ active, onChange }) {
  const tabs = [
    { id: 'upload', label: 'Upload Documents' },
    { id: 'generate', label: 'Generate Report' },
  ];
  return (
    <nav className="flex items-center gap-2 border-b border-slate-100 pb-px shrink-0">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`relative px-4 py-2.5 text-sm font-medium transition-all duration-150 select-none ${
            active === t.id ? 'text-[#0D9488] font-semibold' : 'text-[#64748B] hover:text-[#0F172A]'
          }`}>
          {t.label}
          {active === t.id && <div className="absolute bottom-0 left-3 right-3 h-0.5 bg-[#0F6E56]" />}
        </button>
      ))}
    </nav>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.mixed;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium"
      style={{ background: m.bg, color: m.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

// ─── Manual Upload modal ──────────────────────────────────────────────────────
// For users without a digital copy of a document. Collects every field needed
// to both classify the expense and generate a genuine document via
// DocumentCanvas — vendor, address, document number, date, line items, and the
// company/personal classification — then renders a live preview of the PDF
// that will be created before the user confirms.
function ManualUploadModal({ onConfirm, onCancel }) {
  const [docType, setDocType] = useState('Invoice');
  const [vendor, setVendor] = useState('');
  const [vendorAddr, setVendorAddr] = useState('');
  const [docNo, setDocNo] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lineItems, setLineItems] = useState([{ desc: '', amt: '' }]);
  const [side, setSide] = useState('deductible');
  const categoryList = side === 'deductible' ? BUSINESS_CATEGORIES : PERSONAL_CATEGORIES;
  const [category, setCategory] = useState(categoryList[0]);
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState('form'); // 'form' | 'preview'

  const handleSideChange = (newSide) => {
    setSide(newSide);
    const list = newSide === 'deductible' ? BUSINESS_CATEGORIES : PERSONAL_CATEGORIES;
    setCategory(list[0]);
  };

  const updateLineItem = (i, field, value) => {
    setLineItems(prev => prev.map((li, idx) => idx === i ? { ...li, [field]: value } : li));
  };
  const addLineItem = () => setLineItems(prev => [...prev, { desc: '', amt: '' }]);
  const removeLineItem = (i) => setLineItems(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);

  const total = lineItems.reduce((s, li) => s + (parseFloat(li.amt) || 0), 0);
  const formattedDate = date ? new Date(date).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  const isValid = vendor.trim() && docNo.trim() && date && lineItems.every(li => li.desc.trim() && parseFloat(li.amt) > 0);

  // Build the doc object that DocumentCanvas will render, shared by the preview
  // step and the final confirm action so what the user sees is what gets saved.
  const buildDoc = () => ({
    id: Date.now() + Math.random(),
    name: `${docType.replace(/\s+/g, '_')}_${(vendor || 'Manual').replace(/\s+/g, '_')}_${date || 'undated'}.pdf`,
    type: docType, fileType: 'pdf', date: formattedDate, amount: fmtRM(total),
    status: side, category, note: notes || 'Manually entered by user — not OCR-scanned.',
    vendor, vendorAddr, docNo, accent: side === 'deductible' ? '#0F6E56' : '#DC2626',
    lineItems: lineItems.map(li => ({ desc: li.desc, amt: parseFloat(li.amt) || 0 })),
    manual: true,
  });

  if (step === 'preview') {
    const previewDoc = buildDoc();
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
        <div className="bg-white rounded-2xl shadow-2xl border border-[#E2E8F0] w-[640px] max-h-[90vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] shrink-0">
            <div>
              <p className="text-sm font-bold text-[#0F172A]">Preview document</p>
              <p className="text-[10px] text-[#64748B] mt-0.5">This is the PDF that will be created and added to your list.</p>
            </div>
            <button onClick={onCancel} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-[#E8EBEF] p-5">
            <DocumentCanvas doc={previewDoc} />
          </div>
          <div className="shrink-0 border-t border-[#E2E8F0] px-6 py-4 flex items-center justify-between gap-3">
            <button onClick={() => setStep('form')}
              className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#64748B] hover:border-[#0D9488] hover:text-[#0D9488] transition-colors">
              ← Back to edit
            </button>
            <button onClick={() => onConfirm(previewDoc)}
              style={{ background: '#F0FDF9' }}
              className={`rounded-xl border-2 px-5 py-2.5 text-sm font-bold transition-colors ${
                side === 'deductible' ? 'border-[#0F6E56] text-[#0F6E56] hover:bg-[#D1FAE5]' : 'border-[#DC2626] text-[#DC2626] hover:bg-[#FEE2E2]'
              }`}>
              Confirm &amp; Add Document
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#E2E8F0] w-[520px] max-h-[90vh] overflow-y-auto p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-[#0F172A]">Manually add a document</p>
            <p className="text-[10px] text-[#64748B] mt-0.5">No file to upload? Enter the details and we&#x2019;ll generate the document for you.</p>
          </div>
          <button onClick={onCancel} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Document type + date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Document type</label>
              <select value={docType} onChange={e => setDocType(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] cursor-pointer">
                {['Invoice', 'Receipt', 'Utility Bill', 'Payroll', 'Purchase Order', 'Bank Statement', 'Other'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488]" />
            </div>
          </div>

          {/* Vendor details */}
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Vendor / payee name</label>
            <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. ABC Trading Sdn Bhd"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Vendor address</label>
            <input type="text" value={vendorAddr} onChange={e => setVendorAddr(e.target.value)} placeholder="e.g. No. 12, Jalan Damai, 50450 Kuala Lumpur"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Document / receipt number</label>
            <input type="text" value={docNo} onChange={e => setDocNo(e.target.value)} placeholder="e.g. INV-2026-0001"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[10px] font-medium text-[#64748B]">Line items</label>
              <button onClick={addLineItem} className="text-[10px] text-[#0D9488] font-semibold hover:text-[#0F6E56] transition-colors">+ Add item</button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="text" value={li.desc} onChange={e => updateLineItem(i, 'desc', e.target.value)} placeholder="Description"
                    className="flex-1 min-w-0 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
                  <input type="number" value={li.amt} onChange={e => updateLineItem(i, 'amt', e.target.value)} placeholder="0.00"
                    className="w-24 shrink-0 rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] text-right focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1]" />
                  <button onClick={() => removeLineItem(i)} className="shrink-0 text-[#CBD5E1] hover:text-[#DC2626] transition-colors" title="Remove line">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#F1F5F9]">
              <span className="text-[10px] font-semibold text-[#64748B]">Total</span>
              <span className="text-xs font-bold text-[#0F172A]">{fmtRM(total)}</span>
            </div>
          </div>

          {/* Classification */}
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Company or personal expense?</label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => handleSideChange('deductible')}
                className={`rounded-lg border-2 px-3 py-2 text-xs font-semibold transition-colors ${
                  side === 'deductible' ? 'border-[#0F6E56] bg-[#ECFDF5] text-[#0F6E56]' : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-[#0D9488]'
                }`}>Company Expense</button>
              <button onClick={() => handleSideChange('non_deductible')}
                className={`rounded-lg border-2 px-3 py-2 text-xs font-semibold transition-colors ${
                  side === 'non_deductible' ? 'border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]' : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-[#DC2626]'
                }`}>Personal Expense</button>
            </div>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] cursor-pointer">
              {categoryList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Any additional context for this expense"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:border-[#0D9488] placeholder:text-[#CBD5E1] resize-none" />
          </div>
        </div>

        <button
          onClick={() => isValid && setStep('preview')}
          disabled={!isValid}
          className={`w-full mt-6 rounded-xl px-4 py-3 text-sm font-bold transition-colors ${
            isValid ? 'bg-[#0F6E56] text-white hover:bg-[#0A5140] cursor-pointer' : 'bg-[#F1F5F9] text-[#CBD5E1] cursor-not-allowed'
          }`}>
          Preview Document →
        </button>
        {!isValid && (
          <p className="text-[9px] text-[#94A3B8] text-center mt-2">Fill in vendor name, document number, date, and at least one valid line item to continue.</p>
        )}
      </div>
    </div>
  );
}

// ─── Upload Tab ───────────────────────────────────────────────────────────────
// Owns everything previously split out to the OCR Evidence tab: status filters,
// the "needs review" banner, inline Company/Personal decision buttons, the
// re-classify action, manual document entry, and a clickable row that opens a
// document preview.
function UploadTab({ docs, onAdd, onRemove, onUpdateStatus }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [reclassDoc, setReclassDoc] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [manualUploadOpen, setManualUploadOpen] = useState(false);

  const handleFiles = useCallback((files) => {
    const statuses = ['deductible', 'deductible', 'mixed', 'non_deductible'];
    Array.from(files).forEach(file => {
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const category = status === 'non_deductible'
        ? PERSONAL_CATEGORIES[Math.floor(Math.random() * PERSONAL_CATEGORIES.length)]
        : status === 'mixed' ? REVIEW_CATEGORY
        : BUSINESS_CATEGORIES[Math.floor(Math.random() * BUSINESS_CATEGORIES.length)];
      const amount = Math.floor(Math.random() * 5000 + 100);
      const fileType = /\.(jpg|jpeg|png)$/i.test(file.name) ? 'image'
        : /\.(xlsx|xls|csv)$/i.test(file.name) ? 'excel'
        : 'pdf';
      onAdd({
        id: Date.now() + Math.random(), name: file.name, type: 'Uploaded', fileType,
        date: new Date().toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }),
        amount: `RM ${amount.toLocaleString()}`, status, category,
        note: 'AI classification — please review.',
        reason: status === 'mixed' ? 'This item shares characteristics with both business and personal spending patterns, and the AI could not find enough context on the receipt to confidently separate the two.' : undefined,
        question: status === 'mixed' ? 'Was this purchase made primarily for business use, or primarily for personal use?' : undefined,
        source: status === 'mixed' ? 'LHDN Public Ruling — wholly & exclusively business-use test' : undefined,
        vendor: 'Newly Uploaded Document', vendorAddr: 'Vendor details pending OCR confirmation', docNo: `DOC-${Math.floor(Math.random() * 90000 + 10000)}`,
        accent: status === 'deductible' ? '#0F6E56' : status === 'non_deductible' ? '#DC2626' : '#F59E0B',
        lineItems: fileType !== 'excel' ? [{ desc: file.name, amt: amount }] : undefined,
        sheetRows: fileType === 'excel' ? [['Date', 'Description', 'Amount (RM)'], [new Date().toLocaleDateString('en-MY'), file.name, amount.toFixed(2)]] : undefined,
      });
    });
  }, [onAdd]);

  const mixed = docs.filter(d => d.status === 'mixed');
  const availableCategories = [...new Set(docs.map(d => d.category))].sort();
  const availableYears = [...new Set(docs.map(d => {
    const m = d.date.match(/\d{4}/);
    return m ? m[0] : null;
  }).filter(Boolean))].sort((a, b) => b - a);

  let filtered = docs.filter(d => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && d.category !== categoryFilter) return false;
    if (yearFilter !== 'all') {
      const m = d.date.match(/\d{4}/);
      if (!m || m[0] !== yearFilter) return false;
    }
    return true;
  });
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'date_desc') return new Date(b.date) - new Date(a.date);
    if (sortBy === 'date_asc') return new Date(a.date) - new Date(b.date);
    if (sortBy === 'amount_desc') return parseAmt(b.amount) - parseAmt(a.amount);
    if (sortBy === 'amount_asc') return parseAmt(a.amount) - parseAmt(b.amount);
    if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
    return 0;
  });

  const handleReclassifyConfirm = (status, category) => {
    onUpdateStatus(reclassDoc.id, status, { category });
    setReclassDoc(null);
    // keep preview in sync if it was open on the same doc
    setPreviewDoc(prev => (prev && prev.id === reclassDoc.id ? null : prev));
  };

  return (
    <>
      {reclassDoc && (
        <ReclassifyModal doc={reclassDoc} onConfirm={handleReclassifyConfirm} onCancel={() => setReclassDoc(null)} />
      )}
      {previewDoc && (
        <DocumentPreview
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onReclassify={(d) => { setPreviewDoc(null); setReclassDoc(d); }}
        />
      )}
      {manualUploadOpen && (
        <ManualUploadModal
          onConfirm={(newDoc) => { onAdd(newDoc); setManualUploadOpen(false); }}
          onCancel={() => setManualUploadOpen(false)}
        />
      )}

      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* Drop zone */}
        <div
          className={`shrink-0 rounded-xl border-2 border-dashed p-5 text-center transition-colors cursor-pointer ${
            dragging ? 'border-[#0D9488] bg-[#ECFDF5]' : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-[#0D9488]'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
          <div className="mx-auto mb-2 h-9 w-9 rounded-full bg-[#ECFDF5] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F6E56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-[#0F172A]">Drop files here or <span className="text-[#0D9488]">browse</span></p>
          <p className="mt-0.5 text-[10px] text-[#64748B]">PDF, JPG, PNG — receipts, invoices, bank statements, salary vouchers</p>
          <p className="mt-2 text-[10px] text-[#94A3B8]">
            No file to upload?{' '}
            <button onClick={(e) => { e.stopPropagation(); setManualUploadOpen(true); }}
              className="text-[#0D9488] font-semibold hover:text-[#0F6E56] underline transition-colors">
              Manually add a document
            </button>
          </p>
        </div>

        {/* Needs-review banner */}
        {/* {mixed.length > 0 && (
          <div className="shrink-0 flex items-start gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
            <svg className="mt-0.5 shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div className="flex-1">
              <p className="text-xs font-semibold text-[#B45309]">{mixed.length} item{mixed.length > 1 ? 's' : ''} need your review</p>
              <p className="text-[10px] text-[#92400E] mt-0.5">Classify each as a company or personal expense to complete your tax picture.</p>
            </div>
            <button onClick={() => setStatusFilter('mixed')}
              className="shrink-0 rounded-lg bg-[#B45309] px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-[#92400E] transition-colors">
              Review now
            </button>
          </div>
        )} */}

        {/* Filter & sort bar */}
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          {[
            { id: 'all', label: 'All' },
            { id: 'deductible', label: 'Company Expense' },
            { id: 'non_deductible', label: 'Personal Expense' },
            { id: 'mixed', label: `Needs Review${mixed.length ? ` (${mixed.length})` : ''}` },
          ].map(f => (
            <button key={f.id} onClick={() => setStatusFilter(f.id)}
              className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
                statusFilter === f.id ? 'bg-[#0F6E56] text-white' : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
              }`}>{f.label}</button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}
              className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[10px] text-[#334155] focus:outline-none focus:border-[#0D9488] cursor-pointer">
              <option value="all">All years</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[10px] text-[#334155] focus:outline-none focus:border-[#0D9488] cursor-pointer">
              <option value="all">All categories</option>
              {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-1.5 text-[10px] text-[#334155] focus:outline-none focus:border-[#0D9488] cursor-pointer">
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="amount_desc">Amount: high to low</option>
              <option value="amount_asc">Amount: low to high</option>
              <option value="name_asc">Name A–Z</option>
            </select>
          </div>
        </div>

        {/* Document list */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white">
          {filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <p className="text-xs text-[#94A3B8]">
                {docs.length === 0 ? 'No documents yet. Drop files above to begin.' : 'No documents match the current filters.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#F8FAFC]">
                <tr className="border-b border-[#E2E8F0]">
                  {['File', 'Amount', 'Category', 'Classification', 'Date', ''].map(h => (
                    <th key={h} className="py-2.5 px-3 first:pl-4 last:pr-4 text-left text-[10px] font-semibold text-[#64748B] last:text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((doc) => (
                  <tr key={doc.id}
                    onClick={() => setPreviewDoc(doc)}
                    className="border-b border-[#F1F5F9] last:border-0 cursor-pointer bg-white hover:bg-[#F1F5F9] transition-colors">
                    <td className="py-2.5 pl-4 pr-3">
                      <p className="font-medium text-[#0F172A] text-xs leading-tight truncate max-w-[150px]">{doc.name}</p>
                      <p className="text-[9px] text-[#94A3B8] mt-0.5">{doc.type}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold text-[#0F172A] whitespace-nowrap">{doc.amount}</td>
                    <td className="px-3 py-2.5 text-[10px] text-[#334155] max-w-[120px] truncate">{doc.category}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={doc.status} /></td>
                    <td className="px-3 py-2.5 text-[10px] text-[#64748B] whitespace-nowrap">{doc.date}</td>
                    <td className="py-2.5 pr-4 text-right">
                      <button onClick={(e) => { e.stopPropagation(); onRemove(doc.id); }} className="text-[#CBD5E1] hover:text-[#DC2626] transition-colors" title="Remove">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="shrink-0 text-[10px] text-[#94A3B8]">{filtered.length} of {docs.length} documents shown · Click a row to preview</p>
      </div>
    </>
  );
}

// ─── Reclassify modal ─────────────────────────────────────────────────────────
// Two modes, based on the document's current status:
//  - MIXED:     "why the AI couldn't decide" + a guiding question, as before.
//  - CLASSIFIED: "why the AI placed it here" + a prompt asking the user to
//    confirm or correct that placement, since they're choosing to revisit it.
// In both modes the user can also pick a specific category before confirming,
// so the final category reflects their judgment rather than a hardcoded default.
function ReclassifyModal({ doc, onConfirm, onCancel }) {
  const isMixed = doc.status === 'mixed';

  // Which side (company/personal) is currently selected for the category list —
  // defaults to the doc's existing side so the dropdown starts on a sensible list.
  const initialSide = doc.status === 'non_deductible' ? 'non_deductible' : 'deductible';
  const [side, setSide] = useState(initialSide);
  const categoryList = side === 'deductible' ? BUSINESS_CATEGORIES : PERSONAL_CATEGORIES;
  const [category, setCategory] = useState(
    categoryList.includes(doc.category) ? doc.category : categoryList[0]
  );

  const handleSideChange = (newSide) => {
    setSide(newSide);
    const list = newSide === 'deductible' ? BUSINESS_CATEGORIES : PERSONAL_CATEGORIES;
    setCategory(list.includes(doc.category) ? doc.category : list[0]);
  };

  // A plain-language explanation of why the AI placed a confirmed doc where it did —
  // used only when the user opens "Re-classify" on an already-decided item.
  const placementReason = doc.placementReason ||
    `The AI matched this document to "${doc.category}" based on the vendor, line items, and amount pattern typically seen in that category.`;

  // Confidence score shown beside the title: mixed items are inherently a coin-flip
  // for the AI (hence the fixed 50%), while already-classified items carry the
  // model's actual confidence from OCR capture + classification — varies per doc.
  const confidenceScore = isMixed ? 50 : (doc.confidence ?? 75);
  const confidenceTone = confidenceScore >= 90 ? { color: '#0F6E56', bg: '#ECFDF5' }
    : confidenceScore >= 75 ? { color: '#B45309', bg: '#FFFBEB' }
    : { color: '#DC2626', bg: '#FEF2F2' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#E2E8F0] w-[460px] max-h-[85vh] overflow-y-auto p-6 mx-4" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#0F172A]">{isMixed ? 'Classify this expense' : 'Re-classify this expense'}</p>
            <p className="text-[10px] text-[#64748B] mt-0.5 truncate">{doc.name} · {doc.amount}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-end">
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: confidenceTone.bg, color: confidenceTone.color }}>
                {confidenceScore}% confidence
              </span>
              <span className="text-[8px] text-[#94A3B8] mt-0.5 mr-0.5">
                {isMixed ? 'AI is undecided' : 'OCR + classification accuracy'}
              </span>
            </div>
            <button onClick={onCancel} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="mb-4" />

        {isMixed && doc.reason ? (
          <>
            {/* Why the AI couldn't decide */}
            <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 mb-3">
              <p className="text-[10px] font-semibold text-[#B45309] mb-1">Why the AI couldn&#x2019;t decide</p>
              <p className="text-[10px] text-[#92400E] leading-relaxed">{doc.reason}</p>
              {doc.source && (
                <p className="text-[9px] text-[#B45309]/80 mt-1.5 italic">Source: {doc.source}</p>
              )}
            </div>
            {/* Guiding question */}
            {doc.question && (
              <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2.5 mb-4">
                <p className="text-[10px] font-semibold text-[#075985] mb-1">A question to help you decide</p>
                <p className="text-[10px] text-[#0C4A6E] leading-relaxed">{doc.question}</p>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Why the AI placed it where it did */}
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 mb-3">
              <p className="text-[10px] font-semibold text-[#334155] mb-1">Why the AI classified it this way</p>
              <p className="text-[10px] text-[#64748B] leading-relaxed">{placementReason}</p>
              <p className="text-[9px] text-[#94A3B8] mt-1.5">
                Currently classified as <span className="font-semibold text-[#0F172A]">{STATUS_META[doc.status]?.label}</span> · <span className="font-semibold text-[#0F172A]">{doc.category}</span>
              </p>
            </div>
            {/* Confirmation prompt */}
            <div className="rounded-lg border border-[#BAE6FD] bg-[#F0F9FF] px-3 py-2.5 mb-4">
              <p className="text-[10px] font-semibold text-[#075985] mb-1">Does this still look right?</p>
              <p className="text-[10px] text-[#0C4A6E] leading-relaxed">
                Knowing why the AI made this call, are you confident this expense belongs here — or does it actually
                belong to a different category than what the AI assumed?
              </p>
            </div>
          </>
        )}

        {/* Company / Personal toggle */}
        <p className="text-xs font-semibold text-[#0F172A] mb-2">Was this a company or personal expense?</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => handleSideChange('deductible')}
            className={`rounded-lg border-2 px-3 py-2 text-xs font-semibold transition-colors ${
              side === 'deductible' ? 'border-[#0F6E56] bg-[#ECFDF5] text-[#0F6E56]' : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-[#0D9488]'
            }`}>
            Company Expense
          </button>
          <button onClick={() => handleSideChange('non_deductible')}
            className={`rounded-lg border-2 px-3 py-2 text-xs font-semibold transition-colors ${
              side === 'non_deductible' ? 'border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]' : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-[#DC2626]'
            }`}>
            Personal Expense
          </button>
        </div>

        {/* Category picker — repopulates the table's Category column on confirm */}
        <label className="block text-[10px] font-medium text-[#64748B] mb-1.5">Specific category</label>
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#0F172A] mb-5 focus:outline-none focus:border-[#0D9488] cursor-pointer">
          {categoryList.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Final decision — single confirm action; the side toggle above already
            determines company vs personal, so this just commits that choice. */}
        <button
          onClick={() => onConfirm(side, category)}
          style={{ background: '#F0FDF9' }}
          className={`w-full rounded-xl border-2 px-4 py-3 text-sm font-bold transition-colors ${
            side === 'deductible'
              ? 'border-[#0F6E56] text-[#0F6E56] hover:bg-[#D1FAE5]'
              : 'border-[#DC2626] text-[#DC2626] hover:bg-[#FEE2E2]'
          }`}
        >
          Confirm as {side === 'deductible' ? 'Company Expense' : 'Personal Expense'}
        </button>
      </div>
    </div>
  );
}

// ─── Document canvas renderer ─────────────────────────────────────────────────
// Draws a genuine receipt/invoice document onto an HTML canvas from the doc's
// structured vendor/line-item data — a real bitmap render (not a placeholder),
// used for both 'pdf' and 'image' file types since the visual layout for a
// scanned receipt and a generated invoice PDF follows the same document grammar.
function DocumentCanvas({ doc }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 580, H = 760;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);

    const accent = doc.accent || '#0F6E56';

    if (doc.fileType === 'image') {
      // Receipt-style layout: centered vendor block on an off-white "paper" background
      ctx.fillStyle = '#FAFAF8';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(doc.vendor || 'Vendor', W / 2, 60);
      ctx.fillStyle = '#64748B';
      ctx.font = '13px sans-serif';
      ctx.fillText(doc.vendorAddr || '', W / 2, 84);

      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(40, 104); ctx.lineTo(W - 40, 104); ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#334155';
      ctx.font = '12px sans-serif';
      ctx.fillText(`Receipt No: ${doc.docNo || '—'}`, 40, 128);
      ctx.textAlign = 'right';
      ctx.fillText(`Date: ${doc.date}`, W - 40, 128);

      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(40, 144); ctx.lineTo(W - 40, 144); ctx.stroke();

      let y = 172;
      ctx.font = '14px sans-serif';
      (doc.lineItems || []).forEach(item => {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#0F172A';
        ctx.fillText(item.desc, 40, y);
        ctx.textAlign = 'right';
        ctx.fillText(`RM ${item.amt.toFixed(2)}`, W - 40, y);
        y += 28;
      });

      y += 6;
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
      y += 30;

      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = accent;
      ctx.textAlign = 'left';
      ctx.fillText('TOTAL', 40, y);
      ctx.textAlign = 'right';
      ctx.fillText(doc.amount, W - 40, y);

      y += 50;
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
      y += 30;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#94A3B8';
      ctx.font = '11px sans-serif';
      ctx.fillText('Thank you for your purchase!', W / 2, y);

      // Faux barcode footer
      let bx = 60;
      const by = H - 60;
      let seed = doc.id * 97;
      const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      ctx.fillStyle = '#0F172A';
      while (bx < W - 60) {
        const bw = [2, 3, 4, 6][Math.floor(rand() * 4)];
        ctx.fillRect(bx, by, bw, 36);
        bx += bw + [2, 3, 4][Math.floor(rand() * 3)];
      }
    } else {
      // PDF-style layout: branded header band + itemized table, like a generated invoice
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, W, 88);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(doc.vendor || 'Vendor', 36, 40);
      ctx.font = '11px sans-serif';
      ctx.fillText(doc.vendorAddr || '', 36, 60);
      ctx.textAlign = 'right';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText((doc.type || 'Document').toUpperCase(), W - 36, 40);
      ctx.font = '11px sans-serif';
      ctx.fillText(`No: ${doc.docNo || '—'}`, W - 36, 60);

      let y = 120;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`Date: ${doc.date}`, 36, y);
      y += 26;

      ctx.fillStyle = '#F1F5F9';
      ctx.fillRect(36, y - 14, W - 72, 26);
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('Description', 44, y + 3);
      ctx.textAlign = 'right';
      ctx.fillText('Amount (RM)', W - 44, y + 3);
      y += 30;

      ctx.font = '12px sans-serif';
      (doc.lineItems || []).forEach(item => {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#334155';
        ctx.fillText(item.desc, 44, y);
        ctx.textAlign = 'right';
        ctx.fillText(item.amt.toLocaleString('en-MY', { minimumFractionDigits: 2 }), W - 44, y);
        y += 18;
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(36, y); ctx.lineTo(W - 36, y); ctx.stroke();
        y += 18;
      });

      y += 6;
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = accent;
      ctx.textAlign = 'left';
      ctx.fillText('Total Due', 44, y);
      ctx.textAlign = 'right';
      ctx.fillText(doc.amount, W - 44, y);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#94A3B8';
      ctx.font = '9px sans-serif';
      ctx.fillText('Generated for demonstration purposes — cukai.ai', W / 2, H - 28);
    }
  }, [doc]);

  return (
    <canvas
      ref={canvasRef}
      className="block mx-auto rounded-lg shadow-xl border border-[#E2E8F0]"
      style={{ background: '#fff' }}
    />
  );
}

// ─── Real spreadsheet table renderer ──────────────────────────────────────────
// Renders genuine row/column data with spreadsheet visual conventions: column
// letter header bar, row number gutter, gridlines, and banded rows.
function SpreadsheetTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  const colCount = rows[0].length;
  const colLetters = Array.from({ length: colCount }, (_, i) => String.fromCharCode(65 + i));

  return (
    <div className="rounded-lg border border-[#E2E8F0] overflow-hidden shadow-xl bg-white">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-[#F1F5F9]">
            <th className="w-8 border border-[#E2E8F0] bg-[#E8EBEF] text-[9px] text-[#94A3B8]"></th>
            {colLetters.map(l => (
              <th key={l} className="border border-[#E2E8F0] bg-[#E8EBEF] text-[9px] font-medium text-[#94A3B8] py-1">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri === 0 ? 'bg-[#0F6E56]' : ri % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFC]'}>
              <td className="border border-[#E2E8F0] bg-[#F1F5F9] text-center text-[9px] text-[#94A3B8] py-1.5">{ri + 1}</td>
              {row.map((cell, ci) => (
                <td key={ci}
                  className={`border border-[#E2E8F0] px-2.5 py-1.5 whitespace-nowrap ${
                    ri === 0 ? 'font-bold text-white' : ci === row.length - 1 ? 'text-right font-medium text-[#0F172A]' : 'text-[#334155]'
                  }`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Document Preview slide-over ──────────────────────────────────────────────
// Click any row in the document list to open this. Slides in from the right,
// mirrors the PdfPreview interaction pattern for consistency. Renders a real
// document (canvas-drawn receipt/invoice, or a real spreadsheet table) rather
// than a mock placeholder, scrollable so every section fits the slider.
function DocumentPreview({ doc, onClose, onReclassify }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  const fileTypeLabel = doc.fileType === 'excel' ? 'Excel spreadsheet' : doc.fileType === 'image' ? 'Image' : 'PDF document';
  return (
    <div className="fixed inset-0 z-50 flex" onClick={handleClose}>
      <div className={`flex-1 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex h-full w-[620px] max-w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#0F172A] truncate">{doc.name}</p>
            <p className="text-[10px] text-[#64748B] mt-0.5">{fileTypeLabel} · {doc.manual ? 'Manually entered' : 'Uploaded'} {doc.date}</p>
          </div>
          <button onClick={handleClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors shrink-0 ml-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Scrollable document preview surface — real rendered content */}
        <div className="flex-1 overflow-y-auto bg-[#E8EBEF] p-5">
          {doc.fileType === 'excel'
            ? <SpreadsheetTable rows={doc.sheetRows} />
            : <DocumentCanvas doc={doc} />}
        </div>

        {/* Classification footer */}
        <div className="shrink-0 border-t border-[#E2E8F0] bg-white px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#64748B]">Classification</span>
            <StatusBadge status={doc.status} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#64748B]">Category</span>
            <span className="text-[10px] font-medium text-[#0F172A]">{doc.category}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#64748B]">Amount</span>
            <span className="text-xs font-bold text-[#0F172A]">{doc.amount}</span>
          </div>
          {doc.status === 'mixed' ? (
            <button onClick={() => onReclassify(doc)}
              className="w-full rounded-lg bg-[#B45309] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#92400E] transition-colors">
              Review &amp; Classify
            </button>
          ) : (
            <button onClick={() => onReclassify(doc)}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-xs font-semibold text-[#64748B] hover:border-[#0D9488] hover:text-[#0D9488] transition-colors">
              Re-classify
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PDF Preview slide-over ───────────────────────────────────────────────────
function PdfPreview({ formId, formData, sc, onClose }) {
  const [zoom, setZoom] = useState(100);
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 300); };

  const { deductibleTotal, nonDeductibleTotal, reviewTotal, totalIncome, chargeableIncome,
    taxCharged, lessInstalment, taxPayable } = formData;

  return (
    <div className="fixed inset-0 z-50 flex" onClick={handleClose}>
      <div className={`flex-1 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} />
      <div
        className={`relative flex h-full w-[680px] max-w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3 bg-[#F8FAFC] shrink-0">
          <div>
            <p className="text-sm font-bold text-[#0F172A]">
              Form {formId} Preview — {formId === 'B' ? 'YA 2025 Personal Return' : `${sc.firm?.name || 'Partnership'} Return`}
            </p>
            <p className="text-[10px] text-[#64748B] mt-0.5">This is a pre-filled draft for your reference. Verify all values before submitting to LHDN.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-2 py-1">
              <button onClick={() => setZoom(z => Math.max(60, z - 10))}
                className="text-[#64748B] hover:text-[#0F172A] px-1 text-sm font-bold">−</button>
              <span className="text-[10px] text-[#64748B] w-8 text-center">{zoom}%</span>
              <button onClick={() => setZoom(z => Math.min(150, z + 10))}
                className="text-[#64748B] hover:text-[#0F172A] px-1 text-sm font-bold">+</button>
            </div>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-[#0F6E56] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0A5140] transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export PDF
            </button>
            <button onClick={handleClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors ml-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#E8EBEF] p-6">
          <div style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', transition: 'transform 0.2s' }}>
            <div className="bg-white mx-auto shadow-xl rounded-lg overflow-hidden" style={{ width: 580 }}>
              <div className="px-6 py-5 flex items-start gap-4 border-b border-[#E2E8F0]">
                <img src={cukaiLogo} alt="cukai.ai logo" className="h-10 w-10 shrink-0" />
                <div className="min-w-0">
                  <span className="select-none text-xl font-bold tracking-tight text-[#0F172A]">
                    cukai<span className="text-[#10B981]">.</span><span className="font-light text-[#64748B]">ai</span>
                  </span>
                  <p className="text-[10px] text-[#64748B] mt-0.5">
                    {formId === 'B' ? 'Pre-filled draft of your personal income tax return' : 'Pre-filled draft of your partnership return'}
                  </p>
                </div>
                <div className="ml-auto shrink-0 text-right">
                  <p className="text-[9px] text-[#94A3B8] uppercase tracking-wider">Form</p>
                  <p className="text-2xl font-black leading-none text-[#0F6E56]">{formId}</p>
                  <p className="text-[9px] text-[#94A3B8] mt-0.5">YA 2025</p>
                </div>
              </div>

              <div className="px-6 py-5 space-y-5 text-[11px]">
                {formId === 'B' ? (
                  <>
                    <PreviewSection title="BASIC PARTICULARS">
                      <PreviewField label="1  Name" value="Aisyah binti Ahmad" />
                      <PreviewField label="2  Tax Identification No. (TIN)" value="SG 12345678901" />
                      <PreviewField label="3  Identification No." value="900101-14-5678" />
                      <PreviewField label="4  Correspondence address" value="No. 12, Jalan Damai 3, 50450 Kuala Lumpur" />
                    </PreviewSection>

                    <PreviewSection title="PART A — PARTICULARS OF INDIVIDUAL">
                      <PreviewField label="A1  Citizen" value="MYS" /><PreviewField label="A2  Gender" value="Female" />
                      <PreviewField label="A3  Date of birth" value="01/01/1990" /><PreviewField label="A4  Status" value="Married" />
                      <PreviewField label="A6  Record-keeping" value="Yes" /><PreviewField label="A7  Type of assessment" value="3 – Separate" />
                    </PreviewSection>

                    <PreviewSection title="PART B — COMPUTATION OF INCOME TAX">
                      <PreviewField label="B1   Statutory income from businesses in Malaysia" value={fmtRM(deductibleTotal)} highlight />
                      <PreviewField label="B2   Statutory income from partnerships in Malaysia" value="RM 235,000" highlight />
                      <PreviewField label="B4   Aggregate statutory income from businesses" value={fmtRM(deductibleTotal + 235000)} />
                      <PreviewField label="B7   Statutory income from employment" value="—" />
                      <PreviewField label="B8   Statutory income from rents" value="—" />
                      <PreviewField label="B11  AGGREGATE INCOME" value={fmtRM(totalIncome)} bold />
                      <PreviewField label="B17  Less: Approved donations / gifts" value="—" />
                      <PreviewField label="B20  TOTAL INCOME [SELF]" value={fmtRM(totalIncome)} bold />
                      <PreviewField label="B23  Total Relief" value="RM 18,000" />
                      <PreviewField label="B24  CHARGEABLE INCOME" value={fmtRM(chargeableIncome)} highlight bold />
                      <PreviewField label="B26  Total Income Tax" value={fmtRM(taxCharged)} />
                      <PreviewField label="B27  Less: Rebates (self)" value="RM 400" />
                      <PreviewField label="B28  TOTAL TAX CHARGED" value={fmtRM(Math.max(0, taxCharged - 400))} bold />
                      <PreviewField label="B33  Less: CP500 instalments paid" value={fmtRM(lessInstalment)} />
                      <PreviewField label="B34  BALANCE TAX PAYABLE" value={fmtRM(taxPayable)} highlight bold />
                    </PreviewSection>

                    <PreviewSection title="PART H — RELIEF">
                      <PreviewField label="H1   Individual and dependent relatives" value="RM 9,000" />
                      <PreviewField label="H2   Expenses for parents" value="—" />
                      <PreviewField label="H5   Education fees (Self)" value="—" />
                      <PreviewField label="H6   Medical expenses (serious diseases)" value="—" />
                      <PreviewField label="H9   Lifestyle (books, internet, devices)" value="—" />
                      <PreviewField label="H13  SSPN net deposit" value="—" />
                      <PreviewField label="H14  Husband / wife" value="—" />
                      <PreviewField label="H16  Child relief" value="—" />
                      <PreviewField label="H17  Life insurance and EPF" value="RM 7,000" />
                      <PreviewField label="H18  Private retirement scheme" value="—" />
                      <PreviewField label="H19  Education and medical insurance" value="RM 2,000" />
                      <PreviewField label="H20  SOCSO contribution" value="—" />
                      <PreviewField label="H22  TOTAL RELIEF" value="RM 18,000" bold highlight />
                    </PreviewSection>

                    <PreviewSection title="PART N — FINANCIAL PARTICULARS (MAIN BUSINESS)">
                      <PreviewField label="N1   Name of business" value="Meridian Print Studio (Sole Prop)" />
                      <PreviewField label="N2   Business code (MSIC)" value="1811" />
                      <PreviewField label="N3   Sales or turnover" value={fmtRM(deductibleTotal + 12000)} />
                      <PreviewField label="N7   Cost of sales" value="—" />
                      <PreviewField label="N8   Gross Profit / Loss" value={fmtRM(deductibleTotal + 12000)} />
                      <PreviewField label="N14  Total other income" value="—" />
                      <PreviewField label="N15  Loan interest" value="—" />
                      <PreviewField label="N16  Salaries and wages" value={fmtRM(14500)} />
                      <PreviewField label="N17  Rental / lease" value={fmtRM(1240)} />
                      <PreviewField label="N22  Repairs and maintenance" value="—" />
                      <PreviewField label="N23  Promotion and advertisement" value={fmtRM(3200)} />
                      <PreviewField label="N25  TOTAL EXPENDITURE" value={fmtRM(deductibleTotal)} bold />
                      <PreviewField label="N26  NET PROFIT / LOSS" value={fmtRM(deductibleTotal + 12000 - deductibleTotal)} bold highlight />
                      <PreviewField label="N27  Non-allowable expenses" value={fmtRM(nonDeductibleTotal)} />
                    </PreviewSection>

                    {reviewTotal > 0 && (
                      <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3">
                        <p className="text-[10px] font-semibold text-[#B45309]">⚠ {fmtRM(reviewTotal)} in expenses are still under review</p>
                        <p className="text-[9px] text-[#92400E] mt-0.5">Classify all mixed items in the OCR Evidence tab before final submission to LHDN.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <PreviewSection title="PARTNERSHIP DETAILS">
                      <PreviewField label="1   Name of partnership" value="Meridian Print Studio" />
                      <PreviewField label="2   Income tax no." value="D 1234567890" />
                      <PreviewField label="3   Reference no. (Reg no.)" value="ROB/2020/001234" />
                      <PreviewField label="4   Number of partners" value="3" />
                      <PreviewField label="5   Basis of apportionment" value="Profit-sharing ratio" />
                      <PreviewField label="6   Record-keeping" value="Yes" />
                    </PreviewSection>

                    <PreviewSection title="PART A — BUSINESS INCOME">
                      <PreviewField label="A1  Business code (MSIC)" value="1811 — Printing of newspapers" />
                      <PreviewField label="A2  Divisible income / loss" value="RM 450,000" highlight bold />
                      <PreviewField label="A3  Partners' benefits (salaries + interest)" value="RM 160,000" />
                      <PreviewField label="A4  Balancing charge" value="—" />
                      <PreviewField label="A5  Balancing allowance and capital allowance" value="RM 60,000" />
                    </PreviewSection>

                    <PreviewSection title="PART F — PARTICULARS OF PARTNERSHIP">
                      <PreviewField label="F1  Registered address" value="No. 12, Jalan Damai 3, 50450 Kuala Lumpur" />
                      <PreviewField label="F2  Main business address" value="Lot 5, Jalan Industri 2, Shah Alam" />
                      <PreviewField label="F5  Employer's no." value="E 1234567890" />
                      <PreviewField label="F6  Precedent partner's name" value="Aisyah binti Ahmad" />
                      <PreviewField label="F7  Telephone no." value="03-1234 5678" />
                    </PreviewSection>

                    <PreviewSection title="PART G — PARTICULARS OF PARTNERS">
                      <div className="bg-[#F8FAFC] rounded-lg overflow-hidden border border-[#F1F5F9]">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="bg-[#F1F5F9]">
                              {['Partner', 'ID No.', 'Share', 'Salary', 'Profit Share', 'Total Allocated'].map(h => (
                                <th key={h} className="px-2 py-1.5 text-left text-[9px] font-semibold text-[#64748B]">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { name: 'Aisyah', id: '900101-14-5678', share: '50%', salary: 'RM 60,000', profit: 'RM 175,000', total: 'RM 235,000' },
                              { name: 'Bopha', id: '880212-10-3456', share: '30%', salary: 'RM 40,000', profit: 'RM 105,000', total: 'RM 145,000' },
                              { name: 'Chong', id: '910330-08-7890', share: '20%', salary: '—', profit: 'RM 70,000', total: 'RM 70,000' },
                            ].map((p, i) => (
                              <tr key={p.name} className={i % 2 === 0 ? '' : 'bg-[#FAFBFC]'}>
                                <td className="px-2 py-1.5 font-semibold text-[#0F172A]">{p.name}</td>
                                <td className="px-2 py-1.5 text-[#64748B]">{p.id}</td>
                                <td className="px-2 py-1.5">{p.share}</td>
                                <td className="px-2 py-1.5">{p.salary}</td>
                                <td className="px-2 py-1.5">{p.profit}</td>
                                <td className="px-2 py-1.5 font-semibold text-[#0F6E56]">{p.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </PreviewSection>

                    <PreviewSection title="PART H — FINANCIAL PARTICULARS">
                      <PreviewField label="H2   Sales or turnover" value="RM 920,000" bold />
                      <PreviewField label="H3   Opening stock" value="—" />
                      <PreviewField label="H4   Purchases and cost of production" value="RM 310,000" />
                      <PreviewField label="H6   Cost of sales" value="RM 310,000" />
                      <PreviewField label="H7   GROSS PROFIT" value="RM 610,000" bold />
                      <PreviewField label="H14  Loan interest" value="—" />
                      <PreviewField label="H15  Salaries and wages" value="RM 100,000" />
                      <PreviewField label="H16  Rental / lease" value="RM 24,000" />
                      <PreviewField label="H22  Other expenses" value="RM 36,000" />
                      <PreviewField label="H24  TOTAL EXPENDITURE" value="RM 160,000" bold />
                      <PreviewField label="H25  NET PROFIT" value="RM 450,000" bold highlight />
                    </PreviewSection>

                    {!sc.canFileFormP && (
                      <div className="rounded-lg border border-[#E0E7FF] bg-[#EEF2FF] px-4 py-3">
                        <p className="text-[10px] font-semibold text-[#4338CA]">View only — submission by Aisyah (Principal Partner)</p>
                        <p className="text-[9px] text-[#4338CA]/80 mt-0.5">You can review this form but only the principal partner can submit Form P to LHDN.</p>
                      </div>
                    )}
                  </>
                )}

                <div className="border-t border-[#E2E8F0] pt-4 text-[9px] text-[#94A3B8] text-center">
                  <p>This is a cukai.ai pre-filled draft — for reference only. File via mytax.hasil.gov.my · Due: 30 Jun 2025</p>
                  <p className="mt-0.5">Contact Hasil Care Line: 03-8911 1000 (Local) / 603-8911 1000 (Overseas)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewSection({ title, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="h-px flex-1 bg-[#E2E8F0]" />
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#64748B] shrink-0">{title}</p>
        <div className="h-px flex-1 bg-[#E2E8F0]" />
      </div>
      <div className="rounded-lg overflow-hidden border border-[#F1F5F9] divide-y divide-[#F1F5F9]">
        {children}
      </div>
    </div>
  );
}

function PreviewField({ label, value, highlight, bold }) {
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
      <span className={`text-[10px] ${bold ? 'font-semibold text-[#0F172A]' : 'text-[#64748B]'}`}>{label}</span>
      <span className={`text-[10px] ml-4 text-right ${bold ? 'font-bold' : 'font-medium'} ${highlight ? 'text-[#0F6E56]' : 'text-[#0F172A]'}`}>{value}</span>
    </div>
  );
}

// ─── Generate Report Tab ──────────────────────────────────────────────────────
function GenerateTab({ docs, scenario, activeScenario, setActiveScenario, selectedForm, setSelectedForm, showPreview, setShowPreview }) {
  const sc = USER_SCENARIOS[activeScenario];

  const deductibleTotal    = docs.filter(d => d.status === 'deductible').reduce((s, d) => s + parseAmt(d.amount), 0);
  const nonDeductibleTotal = docs.filter(d => d.status === 'non_deductible').reduce((s, d) => s + parseAmt(d.amount), 0);
  const reviewTotal        = docs.filter(d => d.status === 'mixed').reduce((s, d) => s + parseAmt(d.amount), 0);
  const partnerShare       = sc.firm ? 235000 : 0;
  const totalIncome        = deductibleTotal + partnerShare;
  const chargeableIncome   = Math.max(0, totalIncome - 18000);

  const calcTax = (ci) => {
    const bands = [
      [5000, 0], [15000, 0.01], [15000, 0.03], [15000, 0.06],
      [20000, 0.11], [30000, 0.19], [150000, 0.25], [Infinity, 0.26],
    ];
    let tax = 0, rem = ci;
    for (const [band, rate] of bands) {
      if (rem <= 0) break;
      const taxable = Math.min(rem, band);
      tax += taxable * rate;
      rem -= taxable;
    }
    return Math.round(tax);
  };
  const taxCharged     = calcTax(chargeableIncome);
  const lessInstalment = Math.round(taxCharged * 0.7);
  const taxPayable     = Math.max(0, taxCharged - 400 - lessInstalment);

  const formData = { deductibleTotal, nonDeductibleTotal, reviewTotal, totalIncome,
    chargeableIncome, taxCharged, lessInstalment, taxPayable };

  const forms = [
    sc.canFileFormB && { id: 'B', title: 'Form B', subtitle: 'Personal income tax — resident who carries on business', tag: 'YA 2025', canGenerate: true, readOnly: false },
    (sc.canViewFormP || sc.canFileFormP) && { id: 'P', title: 'Form P', subtitle: sc.firm ? `${sc.firm.name} · Partnership Return` : 'Partnership Return', tag: sc.firm ? `MSIC ${sc.firm.msic}` : 'Partnership', canGenerate: sc.canFileFormP, readOnly: !sc.canFileFormP },
  ].filter(Boolean);

  return (
    <>
      {showPreview && selectedForm && (
        <PdfPreview formId={selectedForm} formData={formData} sc={sc} onClose={() => setShowPreview(false)} />
      )}
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        {/* Scenario switcher */}
        <div className="shrink-0 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-[#0F172A]">{sc.label}</p>
              <p className="text-[10px] text-[#64748B] mt-0.5">{sc.description}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(USER_SCENARIOS).map(([k, v]) => (
                <button key={k} onClick={() => { setActiveScenario(k); setSelectedForm(null); }}
                  className={`rounded-full px-3 py-1 text-[10px] font-medium transition-colors ${
                    activeScenario === k ? 'bg-[#0F6E56] text-white' : 'bg-white border border-[#E2E8F0] text-[#64748B] hover:border-[#0D9488]'
                  }`}>{v.label}</button>
              ))}
            </div>
          </div>
          {sc.firm && (
            <div className="mt-3 flex items-center gap-3 flex-wrap border-t border-[#E2E8F0] pt-3">
              <span className="text-[10px] text-[#64748B]">Firm: <span className="font-semibold text-[#0F172A]">{sc.firm.name}</span></span>
              <span className="text-[10px] text-[#64748B]">Share: <span className="font-semibold text-[#0F172A]">{sc.firm.share}</span></span>
              {sc.canFileFormP
                ? <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#0F6E56]">Principal Partner</span>
                : <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#64748B]">Partner</span>}
            </div>
          )}
        </div>

        {/* Filing summary stats */}
        {/* <div className="shrink-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total Income', value: fmtRM(totalIncome), color: '#0F6E56' },
            { label: 'Deductible Expenses', value: fmtRM(deductibleTotal), color: '#0D9488' },
            { label: 'Chargeable Income', value: fmtRM(chargeableIncome), color: '#0F172A' },
            { label: 'Est. Tax Payable', value: fmtRM(taxPayable), color: '#B45309' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-[#E2E8F0] bg-white p-3">
              <p className="text-[10px] text-[#64748B]">{label}</p>
              <p className="text-sm font-bold mt-1" style={{ color }}>{value}</p>
            </div>
          ))}
        </div> */}

        {/* Form cards */}
        <div className="shrink-0 grid gap-3 sm:grid-cols-2">
          {forms.map(form => (
            <button key={form.id} onClick={() => setSelectedForm(form.id)}
              className={`text-left rounded-xl border-2 p-4 transition-all ${
                selectedForm === form.id ? 'border-[#0D9488] bg-[#ECFDF5] shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-[#0D9488]'
              } ${form.readOnly ? 'opacity-75' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="h-10 w-10 rounded-xl bg-[#0F6E56] flex items-center justify-center">
                  <span className="text-base font-black text-white">{form.id}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[9px] font-medium text-[#64748B]">{form.tag}</span>
                  {form.readOnly && <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[9px] font-medium text-[#B45309]">View Only</span>}
                </div>
              </div>
              <p className="text-xs font-bold text-[#0F172A]">{form.title}</p>
              <p className="text-[10px] text-[#64748B] mt-0.5 leading-tight">{form.subtitle}</p>
              {!form.readOnly
                ? <p className="mt-2 text-[10px] text-[#0D9488] font-medium">Click to prepare →</p>
                : <p className="mt-2 text-[10px] text-[#B45309]">Principal partner files this form.</p>}
            </button>
          ))}
        </div>

        {/* Form summary + actions */}
        {selectedForm && (() => {
          const form = forms.find(f => f.id === selectedForm);
          return (
            <div className="shrink-0 rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <div>
                  <p className="text-xs font-semibold text-[#0F172A]">
                    Form {selectedForm} — {selectedForm === 'B' ? 'Personal Return YA 2025' : `${sc.firm?.name || 'Partnership'} Return YA 2025`}
                  </p>
                  <p className="text-[10px] text-[#64748B] mt-0.5">Auto-populated from uploaded documents · Verify before submitting to LHDN</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowPreview(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-[#0F6E56] bg-white px-3 py-2 text-xs font-semibold text-[#0F6E56] hover:bg-[#ECFDF5] transition-colors">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                    Preview
                  </button>
                  {!form?.readOnly && (
                    <button onClick={() => setShowPreview(true)}
                      className="flex items-center gap-1.5 rounded-lg bg-[#0F6E56] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0A5140] transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Export PDF
                    </button>
                  )}
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                {selectedForm === 'B' ? (
                  <>
                    <InlineSummary title="Part B — Income Computation">
                      <SRow label="B1  Business income (sole prop / expense deductions)" value={fmtRM(deductibleTotal)} />
                      <SRow label="B2  Partnership income (Meridian Print Studio)" value={sc.firm ? 'RM 235,000' : '—'} />
                      <SRow label="B4  Aggregate business income" value={fmtRM(deductibleTotal + (sc.firm ? 235000 : 0))} />
                      <SRow label="B11 Aggregate income" value={fmtRM(totalIncome)} bold />
                      <SRow label="B17 Less: Donations / gifts" value="—" />
                      <SRow label="B23 Total relief" value="RM 18,000" />
                      <SRow label="B24 Chargeable income" value={fmtRM(chargeableIncome)} bold highlight />
                      <SRow label="B26 Total income tax" value={fmtRM(taxCharged)} />
                      <SRow label="B28 Tax charged (after rebate RM 400)" value={fmtRM(Math.max(0, taxCharged - 400))} bold />
                      <SRow label="B33 Less: CP500 instalments" value={fmtRM(lessInstalment)} />
                      <SRow label="B34 Balance tax payable" value={fmtRM(taxPayable)} bold highlight />
                    </InlineSummary>
                    <InlineSummary title="Part H — Relief Breakdown">
                      <SRow label="H1  Individual & dependent relatives" value="RM 9,000" />
                      <SRow label="H17 Life insurance & EPF" value="RM 7,000" />
                      <SRow label="H19 Education & medical insurance" value="RM 2,000" />
                      <SRow label="H22 TOTAL RELIEF" value="RM 18,000" bold highlight />
                    </InlineSummary>
                    <InlineSummary title="Part N — Business Financial Particulars">
                      <SRow label="N3  Sales / turnover (estimated)" value={fmtRM(deductibleTotal + 12000)} />
                      <SRow label="N16 Salaries and wages" value="RM 14,500" />
                      <SRow label="N17 Rental / lease" value="RM 1,240" />
                      <SRow label="N23 Marketing and promotion" value="RM 3,200" />
                      <SRow label="N25 Total expenditure" value={fmtRM(deductibleTotal)} bold />
                      <SRow label="N27 Non-allowable (personal) expenses" value={fmtRM(nonDeductibleTotal)} />
                    </InlineSummary>
                    {reviewTotal > 0 && (
                      <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3">
                        <p className="text-[10px] font-semibold text-[#B45309]">⚠ {fmtRM(reviewTotal)} still under review</p>
                        <p className="text-[9px] text-[#92400E] mt-0.5">Classify remaining items in the OCR Evidence tab before filing.</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <InlineSummary title="Part A — Business Income (Partnership)">
                      <SRow label="A1  Business code (MSIC)" value="1811" />
                      <SRow label="A2  Divisible income" value="RM 450,000" bold highlight />
                      <SRow label="A3  Partners' benefits (salaries + interest)" value="RM 160,000" />
                      <SRow label="A5  Capital allowances" value="RM 60,000" />
                    </InlineSummary>
                    <InlineSummary title="Part G — Partner Profit Allocation">
                      <SRow label="Aisyah (YOU) · 50% · Salary RM 60,000" value="Total RM 235,000" bold highlight />
                      <SRow label="Bopha · 30% · Salary RM 40,000" value="Total RM 145,000" />
                      <SRow label="Chong · 20% · No salary" value="Total RM 70,000" />
                    </InlineSummary>
                    <InlineSummary title="Part H — Financial Particulars">
                      <SRow label="H2  Revenue" value="RM 920,000" />
                      <SRow label="H6  Cost of sales" value="RM 310,000" />
                      <SRow label="H7  Gross profit" value="RM 610,000" bold />
                      <SRow label="H15 Salaries and wages" value="RM 100,000" />
                      <SRow label="H16 Rental" value="RM 24,000" />
                      <SRow label="H24 Total expenditure" value="RM 160,000" bold />
                      <SRow label="H25 NET PROFIT (divisible income)" value="RM 450,000" bold highlight />
                    </InlineSummary>
                    {!sc.canFileFormP && (
                      <div className="rounded-lg border border-[#E0E7FF] bg-[#EEF2FF] p-3">
                        <p className="text-[10px] text-[#4338CA] font-semibold">You can view but cannot submit Form P.</p>
                        <p className="text-[9px] text-[#4338CA]/80 mt-0.5">Only Aisyah (principal partner) can file this form with LHDN.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}

function InlineSummary({ title, children }) {
  return (
    <div>
      <p className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-[#94A3B8]">{title}</p>
      <div className="rounded-lg border border-[#F1F5F9] divide-y divide-[#F1F5F9] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SRow({ label, value, bold, highlight }) {
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 ${highlight ? 'bg-[#F0FDF4]' : ''}`}>
      <span className={`text-[10px] ${bold ? 'font-semibold text-[#0F172A]' : 'text-[#64748B]'}`}>{label}</span>
      <span className={`text-[10px] ml-6 text-right ${bold ? 'font-bold' : 'font-medium'} ${highlight ? 'text-[#0F6E56]' : 'text-[#0F172A]'}`}>{value}</span>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
function CukaiAccount() {
  const [tab, setTab]       = useState('upload');
  const [docs, setDocs]     = useState(INITIAL_DOCS);
  const [userScenario]      = useState('B');
  const [activeEntity, setActiveEntity] = useState(null);

  // Load the active entity name and listen for switches from ManageProfile
  useEffect(() => {
    const loadEntity = async () => {
      const entityId = localStorage.getItem('activeEntityId');
      if (!entityId) return;
      try {
        const entity = await getEntityById(parseInt(entityId));
        setActiveEntity(entity);
      } catch (_) {}
    };
    loadEntity();
    window.addEventListener('entitySwitch', loadEntity);
    return () => window.removeEventListener('entitySwitch', loadEntity);
  }, []);

  // Generate Report tab state lifted to root so the Tax Summary chart in the
  // sidebar can reflect it on every tab, not just while Generate Report is active.
  const [activeScenario, setActiveScenario] = useState('B');
  const [selectedForm, setSelectedForm] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const addDoc = useCallback((doc) => setDocs(prev => [doc, ...prev]), []);
  const removeDoc = useCallback((id) => setDocs(prev => prev.filter(d => d.id !== id)), []);
  const updateDocStatus = useCallback((id, status, extra = {}) => {
    setDocs(prev => prev.map(d =>
      d.id !== id ? d : {
        ...d, status,
        category: extra.category !== undefined ? extra.category
          : status === 'non_deductible' ? PERSONAL_CATEGORIES[0]
          : status === 'mixed' ? REVIEW_CATEGORY
          : BUSINESS_CATEGORIES[0],
      }
    ));
  }, []);

  // Compute formData once at root so both the GenerateTab and the persistent
  // Tax Summary chart use the same numbers.
  const sc = USER_SCENARIOS[activeScenario];
  const deductibleTotal = docs.filter(d => d.status === 'deductible').reduce((s, d) => s + parseAmt(d.amount), 0);
  const partnerShare    = sc.firm ? 235000 : 0;
  const totalIncome      = deductibleTotal + partnerShare;
  const chargeableIncome = Math.max(0, totalIncome - 18000);
  const calcTax = (ci) => {
    const bands = [
      [5000, 0], [15000, 0.01], [15000, 0.03], [15000, 0.06],
      [20000, 0.11], [30000, 0.19], [150000, 0.25], [Infinity, 0.26],
    ];
    let tax = 0, rem = ci;
    for (const [band, rate] of bands) {
      if (rem <= 0) break;
      const taxable = Math.min(rem, band);
      tax += taxable * rate;
      rem -= taxable;
    }
    return Math.round(tax);
  };
  const taxCharged     = calcTax(chargeableIncome);
  const lessInstalment = Math.round(taxCharged * 0.7);
  const taxPayable     = Math.max(0, taxCharged - 400 - lessInstalment);
  const formData = { chargeableIncome, totalRelief: 18000, taxPayable };

  return (
    <main className="h-[calc(100vh-4.1rem)] overflow-hidden bg-background font-body flex flex-col">
      <div className="mx-auto w-full max-w-7xl px-6 py-4 flex flex-col flex-1 min-h-0 gap-3">

        {/* Header */}
        <div className="shrink-0">
          <h1 className="font-headings text-2xl font-bold tracking-tight text-headings">Cukai Account</h1>
          <p className="text-xs text-[#64748B] mt-1">Upload receipts, classify expenses, and generate your tax return draft{activeEntity ? ` — ${activeEntity.name}` : ''}.</p>
        </div>

        {/* Tab nav */}
        <CukaiTabNav active={tab} onChange={setTab} />

        {/* Body: tab content + persistent chart sidebar */}
        <div className="flex flex-1 min-h-0 gap-5">
          {/* Main content */}
          <div className="flex-1 min-w-0 min-h-0">
            {tab === 'upload'   && <UploadTab docs={docs} onAdd={addDoc} onRemove={removeDoc} onUpdateStatus={updateDocStatus} />}
            {tab === 'generate' && (
              <GenerateTab
                docs={docs} scenario={userScenario}
                activeScenario={activeScenario} setActiveScenario={setActiveScenario}
                selectedForm={selectedForm} setSelectedForm={setSelectedForm}
                showPreview={showPreview} setShowPreview={setShowPreview}
              />
            )}
          </div>
          {/* Persistent triple-chart sidebar */}
          {/* <ChartSidebar docs={docs} formData={formData} /> */}
        </div>

      </div>
    </main>
  );
}

export default CukaiAccount;