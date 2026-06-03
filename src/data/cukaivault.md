# Cukai Vault Code Explanation

## 1. Page Purpose

Cukai Vault is an SME-focused module for generating, storing, reviewing, and exporting SME tax and business reports.

It is not a personal receipt claiming page. Receipts, OCR evidence, and source documents are shown as supporting evidence for SME reports. They do not mean a tax claim is approved or guaranteed.

The current implementation is frontend only. It uses React state and mock data so the page can be demonstrated without a backend API.

## 2. Main Page Structure

The page is organized into five tabs:

- Reports
- Generate Report
- Linked Supporting Receipts
- OCR Evidence
- Source Documents

Each tab shows one part of the Cukai Vault workflow. This keeps the page clean and avoids showing every section at the same time.

## 3. Why Tabs Are Used

Tabs allow related Cukai Vault functions to stay inside one page. The code uses `activeTab` state to decide which tab content is visible.

This means the app does not need a new route for each tab. Users can switch between report management, report generation, receipts, OCR evidence, and source documents without leaving the Cukai Vault page.

## 4. Main State Variables

`activeTab` controls which tab is currently visible.

`reports` stores the mock SME report list. Generate, upload, rename, archive, and delete actions update this state.

`receipts` stores mock linked supporting receipts. These receipts are evidence for business expenses and report generation.

`ocrEvidence` stores mock OCR extraction records, confidence scores, missing fields, and verification status.

`sourceDocuments` stores mock audit-trail documents such as bank statements, e-invoice records, agreements, and payroll summaries.

Report filters include `search`, `categoryFilter`, `statusFilter`, and `taxYearFilter`.

Receipt filters include `receiptSearch`, `receiptCategoryFilter`, `receiptStatusFilter`, and `receiptReportFilter`.

OCR filters include `ocrSearch`, `ocrConfidenceFilter`, `ocrMissingFilter`, and `ocrStatusFilter`.

Source document filters include `sourceSearch`, `sourceCategoryFilter`, and `sourceStatusFilter`.

Selected item states such as `selectedReport`, `selectedReceipt`, `selectedOcr`, and `selectedSource` control which modal is open.

Modal states such as `uploadOpen`, `renameReport`, `deleteReport`, and `linkTarget` control upload, rename, delete confirmation, and link report modals.

`toast` shows short success messages for frontend-only actions such as download, export, archive, and save.

## 5. Reports Tab

The Reports tab is the main report management area.

It contains the SME Tax Breakdown chart, key financial values, report search and filters, the report table, mobile report cards, and the Report Code & Section Explanation section.

The report table shows SME-safe financial columns such as Total Amount, Deductible Amount, Overall Deductible Tax, and Estimated Tax Impact.

Search and filters help users find a report by name, category, status, or tax year.

Clicking View stores the selected report in `selectedReport`, which opens the report preview modal.

Rename is handled from the Report Name column using the edit control. It is not shown in the Actions column.

## 6. Generate Report Tab

The Generate Report tab contains the report generation form.

The user chooses report type, tax year, report period, and included report sections using checkboxes.

When Generate Report is clicked, the page creates a new mock report object and adds it to the `reports` state array.

This is for frontend demonstration only. In a real system, the generated report would usually be sent to a backend API and saved in a database or file storage.

Generated reports are marked as Ready or Draft depending on whether accountant review is required.

## 7. Linked Supporting Receipts Tab

This tab shows receipts, invoices, and bills that support SME report generation.

These receipts are supporting evidence for deductible business expenses. They are not guaranteed tax claims.

The tab includes search, category filter chips, status filter, linked report filter, and receipt table/cards.

Receipt actions:

- View opens receipt details.
- Link Report connects the receipt to a selected SME report.
- Download shows a mock success toast.
- Mark Reviewed changes the receipt status to Reviewed.

## 8. OCR Evidence Tab

The OCR Evidence tab shows document extraction results.

It includes extracted amount, date, vendor, confidence score, missing fields, linked report, and status.

OCR confidence helps users know which documents are reliable and which need manual checking.

Missing fields show what still needs review, such as invoice number or business use note.

Mark Verified changes the OCR record to Verified and clears missing fields. Recheck simulates running OCR again.

## 9. Source Documents Tab

Source documents are original files that support the audit trail and accountant review.

Examples include:

- Bank statements
- E-invoice records
- Agreements or contracts
- Payroll summaries
- Payment gateway statements
- Supplier statements
- Accountant notes
- Business registration documents

The Source Document Filters chips are functional. Clicking a chip updates `sourceCategoryFilter` and filters the table/cards by document type.

The tab also includes search, status filter, result count, empty state, and actions.

Source document actions:

- View opens document details.
- Download shows a mock success toast.
- Link Report connects the document to a report.
- Archive changes its status to Archived.

## 10. Chart Logic

The SME Tax Breakdown chart uses `chartSegments`.

Each segment represents an SME income or expense classification such as Service Income, Product Sales, Supplier Purchases, Payroll & Staff Cost, or Review / Non-Deductible.

The chart calculates:

- Total chart value
- Segment percentage
- SVG arc length
- SVG offset for each donut segment

The key values beside the chart are:

- Total Reported Income
- Total Deductible Expenses
- Overall Deductible Tax
- Estimated Tax Impact

These values are AI-assisted estimates for review. They are not final tax calculations.

## 11. Table Actions

View opens a preview/detail modal by setting the selected item state.

Download shows a mock toast because there is no backend file download yet.

Archive changes the item status to Archived. It does not delete the item.

Delete opens a confirmation modal first, then removes the report from local state.

Rename is handled from the Report Name column. Saving the rename updates only the matching report in `reports`.

## 12. Modal Logic

The page uses a shared `ModalShell` component for consistent modal layout.

The report preview modal opens when `selectedReport` has a report object.

The receipt detail modal opens when `selectedReceipt` has a receipt object.

The OCR detail modal opens when `selectedOcr` has an OCR record.

The source document modal opens when `selectedSource` has a document object.

The upload modal opens when `uploadOpen` is true.

The rename modal opens when `renameReport` has a report object.

The delete confirmation modal opens when `deleteReport` has a report object.

The link report modal opens when `linkTarget` contains a receipt or source document.

## 13. Tax Disclaimer

The page uses careful SME-safe wording because tax results should not be promised by a frontend prototype.

Important wording includes:

- AI-assisted
- estimated
- needs accountant review
- verify with LHDN or a qualified accountant / tax agent

The page avoids wording such as guaranteed claim, confirmed deduction, approved claim, or final tax payable.

## 14. Frontend-Only Limitation

All data is currently mock data stored in React state.

Actions such as generate, upload, download, archive, delete, link report, mark reviewed, and mark verified only update the frontend.

In the future, these actions can be connected to backend APIs for real database storage, file upload, report generation, and exports.

## 15. How to Test

1. Open Cukai Vault.
2. Switch between all five tabs.
3. Search and filter reports.
4. Generate a report and confirm it appears in the Reports tab.
5. View a report and check the preview modal.
6. Rename a report from the Report Name column.
7. Archive and delete a report.
8. Filter linked supporting receipts by category chip.
9. Filter source documents by category chip.
10. Check the mobile layout to confirm cards are used instead of squeezed tables.
