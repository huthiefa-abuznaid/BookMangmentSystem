# Shelf & Soul

Shelf & Soul is a responsive Next.js and TypeScript library-management application based on the supplied Software Requirements Specification. The development prototype stores its library data in browser Local Storage. Production uses MySQL through the Next.js server API.

## Run locally

```bash
npm install
npm run dev
```

The development server runs the browser-backed prototype. Its demo accounts are `manager@shelfandsoul.local`, `receptionist@shelfandsoul.local`, `warehouse@shelfandsoul.local`, and `lina@example.com`; the password for each is `ShelfSoulDemo2026!`. Prototype accounts and library records live only in that browser and can be cleared by clearing site data. This mode is for demonstration only and does not provide production-grade access control.

For production, create a `.env` file from `.env.example`, set `DATABASE_URL` to a MySQL connection string, set `AUTH_SECRET` to a unique random value of at least 32 characters, and choose a strong `BOOTSTRAP_MANAGER_EMAIL` and `BOOTSTRAP_MANAGER_PASSWORD`. `npm run build` and `npm start` use the production API and MySQL database. Run `npm run db:generate`, `npm run db:migrate:dev` (or `npm run db:migrate` for a deployed migration), and `npm run db:seed` against the configured database. Seeding creates the manager account and sample library data.

### Password recovery

Password recovery uses single-use, SHA-256-hashed reset tokens that expire after 30 minutes. Configure `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`, and the trusted public `APP_BASE_URL` in the deployment environment; the email endpoint must accept a Bearer-authenticated JSON request containing `from`, `to`, `subject`, `text`, and `html`. Requests use a generic response to avoid confirming whether an email belongs to an account. Apply the database migration before enabling this workflow. The Local Storage prototype displays a local-only reset code and does not send email.

### Encrypted scheduled MySQL backups

Install the MySQL command-line client (`mysqldump`) on the host. Set `BACKUP_DIR` to a protected backup destination, `BACKUP_ENCRYPTION_KEY` to a randomly generated 32-byte key encoded as Base64, and optionally `BACKUP_RETENTION_DAYS` (default 30). The key must be stored separately from backup files; never commit it or place backups in a public web directory. Run `npm run db:backup` to stream a consistent MySQL dump into an AES-256-GCM encrypted `.sql.enc` file. Only matching encrypted backup files older than the retention period are removed. The command fails rather than creating an unencrypted dump if configuration or `mysqldump` is unavailable.

For Windows, create a Task Scheduler task running daily as a dedicated account with access to the app directory, MySQL, the configured backup destination, and environment variables. Set the task's **Start in** directory to the project root and run `npm run db:backup` (or the corresponding `node scripts/backup-mysql.mjs` command). Configure the secrets as protected machine/service environment variables accessible only to the task account. Monitor Task Scheduler's last-run result and copy encrypted artifacts to an off-site destination with restricted access. Periodically test recovery in an isolated database; this project does not include automatic decryption/restore.

The Prisma migration in this repository creates a new MySQL database. It does not migrate existing PostgreSQL data; export and migrate that data separately before switching an existing deployment.

In both modes, visitors can register customer accounts. New customer memberships start in Pending status; a Manager or Receptionist must approve membership before the customer can borrow or reserve.

For production development, optionally set `DEMO_ACCOUNT_PASSWORD` before seeding to create sample Receptionist, Warehouseman, and Customer accounts. The sample login addresses are `receptionist@shelfandsoul.local`, `warehouse@shelfandsoul.local`, and `lina@example.com`; all use the value configured for `DEMO_ACCOUNT_PASSWORD`. Leave this option unset in production.

## Current scope

Implemented workflows include role-based dashboards and permissions, visitor catalog/About/Contact/Help views, book catalog editing and restoration, borrowing requests and approvals, direct checkout, returns with condition capture, renewal requests, reservation queues and pickup holds, stock adjustments and damage/loss records, purchase orders and invoice capture, sales/pickup orders, reviews, member registration/editing, supplier editing, fine adjustments, staff account management, audit entries for library and staff actions, filtered CSV/print reports for sales/loans/returns/fines/inventory, and manager-controlled manual library backup/restore.

The production application uses MySQL-backed account registration and login, password hashing, signed HTTP-only sessions, server-side role checks for protected library actions, and database-persisted library state. The development prototype provides current workflows with browser Local Storage; it is demonstration-only and does not provide production-grade access control.

Bookshop orders do not use online payment processing: customers place a cash-on-pickup order, and staff record cash only when the order is collected. In-library sales are cash sales. Fine payments are also recorded by staff when cash is received at the counter. This avoids payment-provider fees and never marks an unpaid order as paid.

This is not yet a complete implementation of the SRS. Remaining or partial areas include email verification and production email-provider configuration, actual scheduled host/off-site backup setup and tested disaster recovery, production-ready public contact/opening-hour details, and migration from JSON snapshot persistence to normalized relational tables. Manual JSON backup files contain member data and are not encrypted; restrict their storage. Configure production secrets and verify recovery procedures before production use.
