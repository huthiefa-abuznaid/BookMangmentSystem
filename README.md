# Shelf & Soul

Shelf & Soul is a responsive Next.js and TypeScript library-management application based on the supplied Software Requirements Specification. The development prototype stores its library data in browser Local Storage. Production uses the Supabase-hosted PostgreSQL database through Prisma and the Next.js server API. Supabase is used as the database only; the project keeps its existing account authentication and does not use Supabase Auth or Storage.

## Run locally

```bash
npm install
npm run dev
```

The development server runs the browser-backed prototype. Its demo accounts are `manager@shelfandsoul.local`, `receptionist@shelfandsoul.local`, `warehouse@shelfandsoul.local`, and `lina@example.com`; the password for each is `ShelfSoulDemo2026!`. Prototype accounts and library records live only in that browser and can be cleared by clearing site data. This mode is for demonstration only and does not provide production-grade access control.

For production, create a `.env` file from `.env.example`. In the Supabase Dashboard, create a project and copy its PostgreSQL connection strings from **Connect**. Set `DATABASE_URL` to the shared transaction-mode pooler URI (IPv4; normally port `6543`) for runtime connections, and `DIRECT_URL` to the shared session-mode pooler URI (normally port `5432`) for Prisma migrations and `pg_dump`. Use the exact host, username, password, and URI parameters Supabase provides; URL-encode any special characters in the password. These are database URIs, not the Supabase API URL or publishable key. Do not commit `.env` or share its connection strings.

Set `AUTH_SECRET` to a unique random value of at least 32 characters, and set a strong `BOOTSTRAP_MANAGER_EMAIL` and `BOOTSTRAP_MANAGER_PASSWORD`. Run `npm run db:generate`, then `npm run db:migrate` for a new database, followed by `npm run db:seed`. `npm run build` and `npm start` use the production API and Supabase PostgreSQL database. The migrations create the application tables in the connected database. Use a fresh Supabase project for this initial migration: changing an existing MySQL deployment to PostgreSQL does not migrate its data or convert MySQL migration history automatically.

Supabase is only the hosted PostgreSQL database here. Authentication remains in the application (bcrypt password hashes and signed HTTP-only cookies); the Supabase Auth and Storage products are not used. Keep database URLs server-side and never prefix them with `NEXT_PUBLIC_`. Prisma connects with database credentials, so the app relies on its server-side authentication and authorization checks rather than Supabase Row Level Security policies; do not expose database credentials to browser code.

### Password recovery

Password recovery uses single-use, SHA-256-hashed reset tokens that expire after 30 minutes. Configure `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`, and the trusted public `APP_BASE_URL` in the deployment environment; the email endpoint must accept a Bearer-authenticated JSON request containing `from`, `to`, `subject`, `text`, and `html`. Requests use a generic response to avoid confirming whether an email belongs to an account. Apply the database migration before enabling this workflow. The Local Storage prototype displays a local-only reset code and does not send email.

### Encrypted scheduled Supabase PostgreSQL backups

Install PostgreSQL command-line tools (`pg_dump`) on the host. Set `DIRECT_URL` (preferred) or `DATABASE_URL` to a direct or session-pooler connection usable by `pg_dump`, `BACKUP_DIR` to a protected destination, and `BACKUP_ENCRYPTION_KEY` to a randomly generated 32-byte key encoded as Base64. `BACKUP_RETENTION_DAYS` is optional (default 30). Keep the key separate from backup files and never commit it or place backups in a public web directory. Run `npm run db:backup` to stream a PostgreSQL dump into an AES-256-GCM encrypted `.sql.enc` file. Only matching encrypted files older than the retention period are removed. The command fails rather than creating an unencrypted dump if configuration or `pg_dump` is unavailable.

For Windows, create a Task Scheduler task running daily as a dedicated account with access to the app directory, Supabase PostgreSQL connection, backup destination, and environment variables. Set the task's **Start in** directory to the project root and run `npm run db:backup` (or `node scripts/backup-postgres.mjs`). Configure secrets as protected machine/service environment variables accessible only to the task account. Monitor the task's last-run result and copy encrypted artifacts to an off-site destination with restricted access. Supabase also provides its own project backup/restore features depending on plan; configure and verify those separately. Periodically test recovery in an isolated database; this project does not include automatic decryption/restore.

The Prisma migrations in this repository target PostgreSQL. They do not automatically migrate existing MySQL data or prototype data in browser Local Storage; export, transform, and verify that data separately before switching an existing deployment.

In both modes, visitors can register customer accounts. New customer memberships start in Pending status; a Manager or Receptionist must approve membership before the customer can borrow or reserve.

For production development, optionally set `DEMO_ACCOUNT_PASSWORD` before seeding to create sample Receptionist, Warehouseman, and Customer accounts. The sample login addresses are `receptionist@shelfandsoul.local`, `warehouse@shelfandsoul.local`, and `lina@example.com`; all use the value configured for `DEMO_ACCOUNT_PASSWORD`. Leave this option unset in production.

## Current scope

Implemented workflows include role-based dashboards and permissions, visitor catalog/About/Contact/Help views, book catalog editing and restoration, borrowing requests and approvals, direct checkout, returns with condition capture, renewal requests, reservation queues and pickup holds, stock adjustments and damage/loss records, purchase orders and invoice capture, sales/pickup orders, reviews, member registration/editing, supplier editing, fine adjustments, staff account management, audit entries for library and staff actions, filtered CSV/print reports for sales/loans/returns/fines/inventory, and manager-controlled manual library backup/restore.

The production application uses Supabase PostgreSQL through Prisma for account registration/login, password hashing, signed HTTP-only sessions, server-side role checks, and library state. This is a database connection, not Supabase Auth; account authentication remains implemented in the application. The development prototype provides current workflows with browser Local Storage; it is demonstration-only and does not provide production-grade access control.

Bookshop orders do not use online payment processing: customers place a cash-on-pickup order, and staff record cash only when the order is collected. In-library sales are cash sales. Fine payments are also recorded by staff when cash is received at the counter. This avoids payment-provider fees and never marks an unpaid order as paid.

This is not yet a complete implementation of the SRS. Remaining or partial areas include email verification and production email-provider configuration, actual scheduled host/off-site backup setup and tested disaster recovery, production-ready public contact/opening-hour details, and migration from JSON snapshot persistence to normalized relational tables. Manual JSON backup files contain member data and are not encrypted; restrict their storage. Configure production secrets and verify recovery procedures before production use.
