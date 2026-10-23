# Shelf & Soul — Project Requirements Summary

## Source and scope

This brief summarizes the important requirements in `Shelf_and_Soul_SRS_with_Technologies.docx`, supplied at `C:\Users\AZ\Downloads\Shelf_and_Soul_SRS_with_Technologies.docx`. The source identifies itself as the final version 3.0 SRS and reports **11 pages** (about 3,779 words), not 100 pages.

Shelf & Soul is a responsive library-management system for a library in Ramallah, Palestine. It covers the book catalog, circulation, reservations, memberships, sales, stock and suppliers, purchase orders, fines, notifications, reports, and audit records. The required interface language is English, and the currency is the Israeli new shekel (₪).

## Users and permissions

- **Manager:** Oversees staff, catalog, policies, suppliers and purchase orders, fines, reports, and system settings.
- **Receptionist:** Handles circulation, customer and membership records, reservations, sales, receipts, fine payments, and limited inventory edits.
- **Warehouseman:** Handles receiving and transferring stock, damaged or missing books, supplier information, and purchase suggestions.
- **Customer:** Searches and reserves books, requests borrowing, buys books, pays fines, manages their profile, and writes eligible reviews.
- **Visitor:** Can use public pages and browse the catalog without signing in.

Permissions must be checked by a trusted backend or service layer. Hiding an action in the interface alone is not sufficient.

## Core business rules

| Area | Required rule |
|---|---|
| Loans | 14-day loan period; maximum 3 concurrent books per customer. |
| Overdue fines | ₪1 per book per overdue day, capped at that book's price. |
| Renewals | One 14-day renewal, only when the loan is not overdue and no one has reserved the book. |
| Reservations | Available for available or borrowed books; queue order follows request time; maximum 3 active reservations per customer. |
| Reservation holds | When a book becomes available, hold it for the first customer for 3 calendar days, then offer it to the next customer. |
| Membership and fines | Expired members cannot borrow or reserve. Customers with unpaid fines above ₪10 cannot borrow, but may still reserve. |
| Sales | Books may be sold in-library or online. Online orders are library pickup only; cancellation is allowed before the order is marked ready. |
| Membership approval | Online or reception registration is allowed, but a Receptionist or Manager must approve membership activation. |
| Purchase orders | A Warehouseman may suggest an order; a Manager must approve it before it is sent to a supplier. |
| Stock and deletion | Stock must not become negative. Each change needs a stock movement record. Deleted books and movements are soft-deleted and restorable by the Manager. |
| Low stock | Default threshold is 3 available copies, unless a different threshold is configured for that book. |
| Reviews | Only customers who borrowed or bought a book may review it, once per book. |

## Required feature areas

1. **Accounts and profiles:** Registration, login, password-rule feedback, password confirmation, reset by email, profile editing, role-specific dashboards, and inactivity logout (15 minutes for staff; 30 minutes for customers, with a one-minute warning).
2. **Catalog:** Search by title, author, category, or ISBN; category/availability filters; sorting; book details; manager-managed books and categories; cover upload validation; book condition and availability states.
3. **Reservations:** Ordered queues, pickup notifications and deadlines, expiry and offer to the next customer, cancellation, and reservation details.
4. **Borrowing and returns:** Customer borrow requests, staff approval or rejection, direct checkout, due dates, eligibility checks, condition-aware returns, renewal decisions, and customer history.
5. **Fines and memberships:** Automatic fine calculation, reasoned manager adjustments or waivers, partial payments, membership approval and management, and alerts seven days before expiry.
6. **Sales:** In-library cash sales, customer carts and checkout, order cancellation rules, stock reduction, and printable/viewable receipts.
7. **Inventory and purchasing:** Warehouse/floor quantities, receiving, transfers, damage and loss records, reasoned manual adjustments, low-stock alerts, supplier records, purchase-order stages, and receipt of ordered items.
8. **Staff and audit:** Staff account management, fixed roles and configurable permissions, protected actions, and an audit trail recording user, action, affected item, time, and before/after values where applicable. Audit entries cannot be edited or deleted by users.
9. **Notifications and reports:** Notifications for reservations, requests, due/overdue loans, fines, memberships, stock, and purchase orders. Role-appropriate reports for sales, loans, returns, fines, and inventory, with filters, printing, and CSV/PDF export.
10. **Public pages and dashboards:** Landing page, About, Contact, Help/FAQ, footer information, and role-specific dashboard summaries.

## User interface and quality requirements

- Support current browsers on desktop, tablet, and phone; remain responsive and English-only.
- Meet WCAG 2.1 AA contrast; label inputs, support keyboard navigation, and show visible focus. Do not convey status by color alone.
- Keep ordinary searches, page loads, and saves within 3 seconds under normal conditions, and verify performance with representative data and concurrency before production.
- Validate inputs; preserve entered form data and show a clear error when an operation fails.
- Keep interface, business logic, and data access separated.
- Back up production data automatically at least weekly using a server-side database or managed backup service; verify recovery in the deployment environment.

## Technology requirements and implementation differences

The source SRS specifies **Next.js**, **TypeScript**, Next.js server-side functionality/API routes, and **MySQL** for production, with browser Local Storage for the prototype.

The current repository instead uses **Next.js 15, React 19, and TypeScript**, with **Prisma and Supabase-hosted PostgreSQL** for the production database. The development prototype uses browser Local Storage. The repository README documents this PostgreSQL architecture and warns that existing MySQL or Local Storage data is not automatically migrated.

The repository README also states that online payment processing is not implemented: customer book orders are cash on pickup, in-library sales are cash, and fines are recorded by staff when cash is received. The SRS requires simulated online payment in the prototype and a real payment provider in production; it also requires customers to be able to pay fines online. The current implementation therefore differs from both the prototype and production payment requirements. Treat this as a specification gap or deliberate scope change that needs stakeholder confirmation before production.

Other production items the README identifies as incomplete or deployment-dependent include email verification, real deployment and testing of scheduled/off-site backups and disaster recovery, production-ready public contact/opening-hour details, and migration from JSON snapshot persistence to normalized relational tables. The README documents CSV/print reports, while the SRS also requires PDF export. Manual JSON backup files contain member data and are not encrypted.

## Acceptance checklist

- Each role sees its own navigation and dashboard, and unauthorized protected actions are rejected.
- Catalog search and book details show accurate price and availability.
- Borrowing, returns, renewals, reservation queues/holds, and fines follow the business rules above.
- Every sale creates a receipt and updates stock; purchase orders cannot be sent without Manager approval.
- Receiving, transfers, damage, loss, adjustments, and deletions are traceable through stock movements and audit records.
- Responsive behavior, accessibility, and ordinary-operation performance are verified.
- Security, audit, payment (if enabled), and weekly backup/recovery are tested in the intended deployment environment.

## Project validation performed

- `npm run typecheck` — passed.
- `npm run build` — passed; Next.js generated the production build and application routes.
- `package.json` does not define a test script, so no `npm test` command is available.
