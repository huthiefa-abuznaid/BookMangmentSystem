"use client";

import { useEffect, useMemo, useState } from "react";
import type { Book, LibraryAction, LibraryState, Member, Role } from "@/lib/types";
import {
  createPrototypeStaff,
  completePrototypePasswordReset,
  getPrototypeStaff,
  getPrototypeLibrary,
  getPrototypeSession,
  loginPrototype,
  logoutPrototype,
  performPrototypeAction,
  registerPrototype,
  requestPrototypePasswordReset,
  restorePrototypeLibrary,
  updatePrototypeStaff,
} from "@/lib/prototype-storage";
import type { PrototypeStaff } from "@/lib/prototype-storage";

interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  memberId: string | null;
}

type Page =
  | "Overview"
  | "Catalog"
  | "Circulation"
  | "Reservations"
  | "Inventory"
  | "Customers"
  | "Settings"
  | "Sales"
  | "Suppliers"
  | "Reports"
  | "Audit"
  | "Profile"
  | "Staff";

const navigation: { page: Page; icon: string; roles: Role[] }[] = [
  {
    page: "Overview",
    icon: "◫",
    roles: ["Manager", "Receptionist", "Warehouseman", "Customer"],
  },
  {
    page: "Catalog",
    icon: "▤",
    roles: ["Manager", "Receptionist", "Warehouseman", "Customer"],
  },
  {
    page: "Circulation",
    icon: "↔",
    roles: ["Manager", "Receptionist", "Customer"],
  },
  {
    page: "Reservations",
    icon: "◷",
    roles: ["Manager", "Receptionist", "Customer"],
  },
  {
    page: "Inventory",
    icon: "▦",
    roles: ["Manager", "Receptionist", "Warehouseman"],
  },
  { page: "Customers", icon: "♙", roles: ["Manager", "Receptionist"] },
  { page: "Sales", icon: "＄", roles: ["Manager", "Receptionist", "Customer"] },
  { page: "Suppliers", icon: "▣", roles: ["Manager", "Warehouseman"] },
  { page: "Reports", icon: "▥", roles: ["Manager", "Receptionist", "Warehouseman"] },
  { page: "Audit", icon: "≡", roles: ["Manager"] },
  { page: "Profile", icon: "♙", roles: ["Manager", "Receptionist", "Warehouseman", "Customer"] },
  { page: "Staff", icon: "♙", roles: ["Manager"] },
  { page: "Settings", icon: "⚙", roles: ["Manager"] },
];

const roleDescriptions: Record<Role, string> = {
  Manager: "Full library overview",
  Receptionist: "Circulation & customer desk",
  Warehouseman: "Inventory & receiving",
  Customer: "Your reading space",
};

const prototypeMode = process.env.NODE_ENV !== "production";

function money(amount: number): string {
  return `₪ ${amount.toFixed(2)}`;
}

function dateLabel(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function shortDate(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function remainingDays(date: string): number {
  const target = new Date(date);
  const today = new Date();
  const targetMidnight = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ).getTime();
  const todayMidnight = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  return Math.round((targetMidnight - todayMidnight) / 86_400_000);
}

function overdueDaysAt(dueAt: string, referenceAt: string | Date): number {
  const due = new Date(dueAt);
  const reference = typeof referenceAt === "string" ? new Date(referenceAt) : referenceAt;
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const referenceDay = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
  return Math.max(0, Math.round((referenceDay - dueDay) / 86_400_000));
}

export default function Home() {
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [page, setPage] = useState<Page>("Overview");
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<Role>("Customer");
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [category, setCategory] = useState("All categories");
  const [availability, setAvailability] = useState("All availability");
  const [sort, setSort] = useState("title");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [saleBookId, setSaleBookId] = useState("");
  const [saleQuantity, setSaleQuantity] = useState(1);
  const [cart, setCart] = useState<{ bookId: string; quantity: number }[]>([]);
  const [coverPreview, setCoverPreview] = useState("");
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [memberEditing, setMemberEditing] = useState<Member | null>(null);
  const [supplierEditingId, setSupplierEditingId] = useState("");
  const [reportKind, setReportKind] = useState<"sales" | "loans" | "returns" | "fines" | "inventory">("sales");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [sessionWarning, setSessionWarning] = useState(false);
  const [staffUsers, setStaffUsers] = useState<PrototypeStaff[]>([]);
  const [newStaffRole, setNewStaffRole] =
    useState<Exclude<Role, "Customer">>("Receptionist");
  const [staffError, setStaffError] = useState("");
  const [returnConditions, setReturnConditions] = useState<Record<string, Book["condition"]>>({});

  useEffect(() => {
    let cancelled = false;

    async function initializeSession() {
      try {
        if (prototypeMode) {
          const user = await getPrototypeSession();
          if (cancelled) return;
          if (user) {
            setAuthUser(user);
            setRole(user.role);
            setCustomerId(user.memberId ?? "");
            setLibrary(await getPrototypeLibrary());
          }
          return;
        }

        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error ?? "Could not verify your account.");
        }
        if (cancelled) return;

        if (result.user) {
          const user = result.user as AuthenticatedUser;
          setAuthUser(user);
          setRole(user.role);
          setCustomerId(user.memberId ?? "");

          const libraryResponse = await fetch("/api/library", {
            cache: "no-store",
          });
          const libraryResult = await libraryResponse.json();
          if (!libraryResponse.ok) {
            throw new Error(
              libraryResult.error ?? "Could not load library data.",
            );
          }
          if (!cancelled) setLibrary(libraryResult.state as LibraryState);
        }
      } catch (sessionError) {
        if (!cancelled) {
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : "Could not connect to Shelf & Soul.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setAuthReady(true);
        }
      }
    }

    void initializeSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setSettledSearch(search.trim().toLowerCase()),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (page !== "Staff" || role !== "Manager") return;
    let cancelled = false;
    async function loadStaff() {
      try {
        if (prototypeMode) {
          const users = getPrototypeStaff();
          if (!cancelled) setStaffUsers(users);
          return;
        }
        const response = await fetch("/api/staff", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load staff accounts.");
        if (!cancelled) setStaffUsers(result.users as PrototypeStaff[]);
      } catch (loadError) {
        if (!cancelled) setStaffError(loadError instanceof Error ? loadError.message : "Could not load staff accounts.");
      }
    }
    void loadStaff();
    return () => { cancelled = true; };
  }, [page, role]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!authUser) return;
    let warningTimer = 0;
    let logoutTimer = 0;
    const timeoutMinutes =
      role === "Customer"
        ? library?.settings?.customerTimeoutMinutes ?? 30
        : library?.settings?.staffTimeoutMinutes ?? 15;
    const timeoutMs = timeoutMinutes * 60_000;
    const activitySyncIntervalMs = Math.min(60_000, timeoutMs / 4);
    let lastActivitySync = 0;
    let activitySyncInProgress = false;
    let active = true;
    const resetTimeout = () => {
      window.clearTimeout(warningTimer);
      window.clearTimeout(logoutTimer);
      setSessionWarning(false);
      warningTimer = window.setTimeout(
        () => setSessionWarning(true),
        Math.max(0, timeoutMs - 60_000),
      );
      logoutTimer = window.setTimeout(() => void signOut(), timeoutMs);

      if (
        activitySyncInProgress ||
        Date.now() - lastActivitySync < activitySyncIntervalMs
      ) return;

      lastActivitySync = Date.now();
      activitySyncInProgress = true;
      void fetch("/api/auth/session", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Could not verify the active session.");
          const result = await response.json();
          if (active && !result.user) await signOut();
        })
        .catch((syncError: unknown) => {
          if (active) {
            setError(
              syncError instanceof Error
                ? syncError.message
                : "Could not verify the active session.",
            );
          }
        })
        .finally(() => {
          activitySyncInProgress = false;
        });
    };
    const events = ["pointerdown", "keydown", "touchstart", "scroll"];
    events.forEach((event) =>
      window.addEventListener(event, resetTimeout, { passive: true }),
    );
    resetTimeout();
    return () => {
      active = false;
      events.forEach((event) => window.removeEventListener(event, resetTimeout));
      window.clearTimeout(warningTimer);
      window.clearTimeout(logoutTimer);
    };
  }, [
    authUser,
    role,
    library?.settings?.staffTimeoutMinutes,
    library?.settings?.customerTimeoutMinutes,
  ]);

  const currentMember = library?.members.find(
    (member) => member.id === customerId,
  );
  const visiblePages = navigation.filter((item) => item.roles.includes(role));

  async function refreshLibrary(): Promise<LibraryState> {
    if (prototypeMode) {
      const state = await getPrototypeLibrary();
      setLibrary(state);
      return state;
    }
    const response = await fetch("/api/library", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not refresh library data.");
    setLibrary(result.state as LibraryState);
    return result.state as LibraryState;
  }

  async function onAuthenticated(user: AuthenticatedUser) {
    setLoading(true);
    try {
      if (prototypeMode) {
        const state = await getPrototypeLibrary();
        setAuthUser(user);
        setRole(user.role);
        setCustomerId(user.memberId ?? "");
        setLibrary(state);
        setPage("Overview");
        setError("");
        return;
      }

      const response = await fetch("/api/library", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Could not load library data.");
      }
      setAuthUser(user);
      setRole(user.role);
      setCustomerId(user.memberId ?? "");
      setLibrary(result.state as LibraryState);
      setPage("Overview");
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load library data.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function perform(action: LibraryAction, successMessage: string): Promise<boolean> {
    try {
      if (prototypeMode) {
        const next = await performPrototypeAction(
          action,
          role,
          authUser?.memberId ?? null,
          authUser?.name ?? role,
        );
        setLibrary(next);
        if (action.type === "updateProfile") {
          setAuthUser((current) =>
            current
              ? {
                  ...current,
                  name: action.name.trim(),
                  email: action.email.trim().toLowerCase(),
                  phone: action.phone.trim(),
                }
              : current,
          );
        }
        setError("");
        setToast(successMessage);
        return true;
      }

      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "The requested action could not be completed.");
      }
      setLibrary(result.state as LibraryState);
      if (action.type === "updateProfile") {
        setAuthUser((current) =>
          current
            ? {
                ...current,
                name: action.name.trim(),
                email: action.email.trim().toLowerCase(),
              }
            : current,
        );
      }
      setError("");
      setToast(successMessage);
      return true;
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The requested action could not be completed.",
      );
      return false;
    }
  }

  async function signOut() {
    try {
      if (prototypeMode) {
        logoutPrototype();
        setAuthUser(null);
        setLibrary(null);
        setPage("Overview");
        setError("");
        return;
      }

      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out. Please try again.");
      setAuthUser(null);
      setLibrary(null);
      setPage("Overview");
      setError("");
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : "Could not sign out.",
      );
    }
  }

  const categories = useMemo(
    () => [
      "All categories",
      ...(library?.categories ?? [...new Set((library?.books ?? []).map((book) => book.category))]),
    ],
    [library?.books],
  );

  const filteredBooks = useMemo(() => {
    if (!library) return [];
    const visible = library.books.filter((book) => {
      if (book.deletedAt) return false;
      const matchesSearch =
        !settledSearch ||
        [book.title, book.author, book.category, book.isbn].some((value) =>
          value.toLowerCase().includes(settledSearch),
        );
      const matchesCategory =
        category === "All categories" || book.category === category;
      const activeLoans = library.loans.filter(
        (loan) => loan.bookId === book.id && loan.status === "Active",
      ).length;
      const held = library.reservations.filter(
        (reservation) =>
          reservation.bookId === book.id &&
          reservation.status === "Ready for pickup" &&
          (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
      ).length;
      const copies = book.quantity - activeLoans - (book.damagedQuantity ?? 0) - held;
      const matchesAvailability =
        availability === "All availability" ||
        (availability === "Available" && copies > 0) ||
        (availability === "Out of stock" && copies <= 0);
      return matchesSearch && matchesCategory && matchesAvailability;
    });
    return visible.sort((a, b) => {
      if (sort === "price") return a.price - b.price;
      if (sort === "author") return a.author.localeCompare(b.author);
      if (sort === "rating") {
        const average = (bookId: string) => {
          const reviews = library.reviews?.filter((review) => review.bookId === bookId) ?? [];
          return reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
        };
        return average(b.id) - average(a.id);
      }
      return a.title.localeCompare(b.title);
    });
  }, [library, settledSearch, category, availability, sort]);

  if (!authReady) {
    return (
      <main className="loading-screen">
        <span className="spinner" /> Checking your account…
      </main>
    );
  }

  if (!authUser) {
    return (
      <AuthPage
        initialError={error}
        prototypeMode={prototypeMode}
        onAuthenticated={(user) => void onAuthenticated(user)}
      />
    );
  }

  if (loading || !library) {
    return (
      <main className="loading-screen">
        <span className="spinner" /> Opening your library…
      </main>
    );
  }

  const data: LibraryState = library;
  const activeLoans = data.loans.filter((loan) => loan.status === "Active");
  const pendingRequests = data.requests.filter(
    (request) => request.status === "Pending",
  );
  const pendingMemberships = data.members.filter(
    (member) => member.membershipStatus === "Pending",
  );
  const activeReservations = data.reservations.filter((reservation) =>
    ["Queued", "Ready for pickup"].includes(reservation.status),
  );
  const readyReservations = activeReservations.filter(
    (reservation) => reservation.status === "Ready for pickup",
  );
  const suggestedPurchaseOrders = (data.purchaseOrders ?? []).filter(
    (order) => order.status === "Suggested",
  );
  const lowStockBooks = data.books.filter(
    (book) =>
      !book.deletedAt &&
      book.quantity -
        activeLoans.filter((loan) => loan.bookId === book.id).length -
        (book.damagedQuantity ?? 0) -
        data.reservations.filter((reservation) =>
          reservation.bookId === book.id &&
          reservation.status === "Ready for pickup" &&
          (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
        ).length <=
        (book.stockThreshold ?? data.settings?.lowStockThreshold ?? 3),
  );
  const visibleNotices =
    role === "Customer"
      ? data.notices.filter((notice) => notice.memberId === customerId)
      : data.notices;
  const unreadNotices = visibleNotices.filter((notice) => !notice.read).length;
  const recentLoans = [...activeLoans].sort(
    (first, second) => Date.parse(second.issuedAt) - Date.parse(first.issuedAt),
  );
  const recentNotices = [...data.notices].sort(
    (first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt),
  );
  const recentVisibleNotices =
    role === "Customer"
      ? [...visibleNotices].sort(
          (first, second) =>
            Date.parse(second.createdAt) - Date.parse(first.createdAt),
        )
      : recentNotices;
  const customerLoans = activeLoans.filter(
    (loan) => loan.memberId === customerId,
  );
  const pageTitle = selectedBook && page === "Catalog" ? "Book details" : page;
  const greeting =
    role === "Customer"
      ? (currentMember?.name.split(" ")[0] ?? authUser.name.split(" ")[0])
      : authUser.name.split(" ")[0];

  function goTo(nextPage: Page) {
    setPage(nextPage);
    setSelectedBook(null);
    setMobileMenuOpen(false);
    setError("");
  }

  function bookAvailability(book: Book): { label: string; count: number } {
    const borrowed = activeLoans.filter(
      (loan) => loan.bookId === book.id,
    ).length;
    const reserved = data.reservations.filter(
      (reservation) =>
        reservation.bookId === book.id &&
        reservation.status === "Ready for pickup" &&
        (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
    ).length;
    const count = Math.max(0, book.quantity - borrowed - (book.damagedQuantity ?? 0) - reserved);
    if (reserved > 0) return { label: "Reserved", count };
    if (count <= 0) return { label: "Out of stock", count: 0 };
    return {
      label: borrowed >= book.quantity ? "Borrowed" : "Available",
      count,
    };
  }

  function renderOverview() {
    const customerRole = role === "Customer";
    const currentHour = new Date().getHours();
    const timeGreeting =
      currentHour < 12
        ? "Good morning"
        : currentHour < 18
          ? "Good afternoon"
          : "Good evening";
    const statCards = customerRole
      ? [
          {
            label: "Books on loan",
            value: customerLoans.length,
            icon: "▤",
            note: "Your current reads",
          },
          {
            label: "Reservations",
            value: data.reservations.filter(
              (item) =>
                item.memberId === customerId &&
                ["Queued", "Ready for pickup"].includes(item.status),
            ).length,
            icon: "◷",
            note: "In your reading queue",
          },
          {
            label: "Outstanding fines",
            value: money(currentMember?.unpaidFines ?? 0),
            icon: "₪",
            note: "Your account balance",
          },
        ]
      : role === "Warehouseman"
        ? [
            {
              label: "Titles in catalog",
              value: data.books.filter((book) => !book.deletedAt).length,
              icon: "▤",
              note: "Across all categories",
            },
            {
              label: "Low-stock titles",
              value: lowStockBooks.length,
              icon: "⚑",
              note: "At or below configured threshold",
            },
            {
              label: "Movements today",
              value: data.movements.filter(
                (item) =>
                  new Date(item.createdAt).toDateString() ===
                  new Date().toDateString(),
              ).length,
              icon: "↔",
              note: "Recent stock activity",
            },
          ]
        : [
            {
              label: "Books in catalog",
              value: data.books.filter((book) => !book.deletedAt).length,
              icon: "▤",
              note: "Across all categories",
            },
            {
              label: "Active loans",
              value: activeLoans.length,
              icon: "↗",
              note: "Books with readers",
            },
            {
              label: "Pending requests",
              value: pendingRequests.length,
              icon: "◷",
              note: "Awaiting your attention",
            },
            {
              label: "Low-stock titles",
              value: lowStockBooks.length,
              icon: "⚑",
              note: "At or below configured threshold",
            },
          ];

    return (
      <>
        <section className="welcome-row">
          <div>
            <div className="eyebrow">
              {new Intl.DateTimeFormat("en", {
                weekday: "long",
                month: "long",
                day: "numeric",
              }).format(new Date())}
            </div>
            <h2>
              {customerRole
                ? `Welcome back, ${greeting}.`
                : `${timeGreeting}, ${greeting}.`}
            </h2>
            <p>
              {customerRole
                ? "A little time with a good book can change everything."
                : "Here’s what’s happening at Shelf & Soul today."}
            </p>
          </div>
          <button
            className="button button-primary"
            onClick={() => goTo("Catalog")}
          >
            Explore the catalog <span aria-hidden="true">→</span>
          </button>
        </section>
        {role === "Customer" &&
          currentMember &&
          remainingDays(currentMember.membershipExpiresAt) <= 7 &&
          remainingDays(currentMember.membershipExpiresAt) >= 0 && (
            <div className="error-banner" role="status">
              <span>!</span>
              <p>
                Your membership expires in {remainingDays(currentMember.membershipExpiresAt)} days.
                Contact the library to renew it.
              </p>
            </div>
          )}

        <section
          className={`stat-grid ${statCards.length === 3 ? "three-stats" : ""}`}
          aria-label="Library statistics"
        >
          {statCards.map((stat) => (
            <article className="stat-card" key={stat.label}>
              <div className="stat-top">
                <span>{stat.label}</span>
                <span className="stat-icon">{stat.icon}</span>
              </div>
              <strong>{stat.value}</strong>
              <small>{stat.note}</small>
            </article>
          ))}
        </section>

        {role === "Manager" && (
          <section className="panel manager-actions-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Manager workspace</div>
                <h3>Approvals and team</h3>
              </div>
            </div>
            <div className="manager-action-grid">
              <button
                className="manager-action"
                onClick={() => goTo("Customers")}
              >
                <strong>{pendingMemberships.length}</strong>
                <span>Memberships awaiting approval</span>
                <small>Review customer registrations →</small>
              </button>
              <button
                className="manager-action"
                onClick={() => goTo("Suppliers")}
              >
                <strong>{suggestedPurchaseOrders.length}</strong>
                <span>Purchase orders awaiting approval</span>
                <small>Review purchase suggestions →</small>
              </button>
              <button
                className="manager-action"
                onClick={() => goTo("Reservations")}
              >
                <strong>{activeReservations.length}</strong>
                <span>Active reservations</span>
                <small>{readyReservations.length} ready for pickup · Review queue →</small>
              </button>
              <button
                className="manager-action"
                onClick={() => {
                  setNewStaffRole("Warehouseman");
                  goTo("Staff");
                }}
              >
                <strong aria-hidden="true">+</strong>
                <span>Create warehouse account</span>
                <small>Manager-created staff access →</small>
              </button>
            </div>
          </section>
        )}

        <div className="content-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Your next chapter</div>
                <h3>
                  {customerRole ? "Currently reading" : "Recent circulation"}
                </h3>
              </div>
              <button
                className="text-button"
                onClick={() =>
                  goTo(customerRole ? "Circulation" : "Circulation")
                }
              >
                View all <span aria-hidden="true">→</span>
              </button>
            </div>
            {customerRole ? (
              customerLoans.length ? (
                <div className="loan-list">
                  {customerLoans.map((loan) => {
                    const book = data.books.find(
                      (item) => item.id === loan.bookId,
                    );
                    if (!book) return null;
                    const days = remainingDays(loan.dueAt);
                    return (
                      <div className="loan-row" key={loan.id}>
                        <BookCover book={book} compact />
                        <div className="loan-info">
                          <strong>{book.title}</strong>
                          <span>{book.author}</span>
                        </div>
                        <span
                          className={`due-label ${days < 0 ? "overdue" : ""}`}
                        >
                          {days < 0
                            ? `${Math.abs(days)}d overdue`
                            : `Due in ${days}d`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text="You don’t have any books checked out yet." />
              )
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>LOAN</th>
                      <th>READER</th>
                      <th>BOOK</th>
                      <th>DUE DATE</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLoans.slice(0, 5).map((loan) => {
                      const member = data.members.find(
                        (item) => item.id === loan.memberId,
                      );
                      const book = data.books.find(
                        (item) => item.id === loan.bookId,
                      );
                      const late = remainingDays(loan.dueAt) < 0;
                      return (
                        <tr key={loan.id}>
                          <td className="mono">{loan.id}</td>
                          <td>{member?.name}</td>
                          <td>{book?.title}</td>
                          <td>{dateLabel(loan.dueAt)}</td>
                          <td>
                            <StatusBadge
                              label={late ? "Overdue" : "On loan"}
                              tone={late ? "danger" : "info"}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Needs a little care</div>
                <h3>{customerRole ? "Your reminders" : "Library alerts"}</h3>
              </div>
              <span className="alert-count">
                {data.notices.filter((item) => !item.read).length}
              </span>
            </div>
            {visibleNotices.length ? (
              <div className="alert-list">
                {recentVisibleNotices.slice(0, 4).map((notice) => (
                  <div className="alert-row" key={notice.id}>
                    <span
                      className={`alert-dot ${notice.read ? "read" : ""}`}
                    />
                    <div>
                      <p>{notice.message}</p>
                      <span>{shortDate(notice.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="You’re all caught up." />
            )}
            {!customerRole && (
              <button
                className="button button-secondary full-button"
                onClick={() => goTo("Inventory")}
              >
                Review inventory
              </button>
            )}
          </section>
        </div>

        <section className="panel featured-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">{customerRole ? "Picked for you" : "Explore the collection"}</div>
              <h3>
                {customerRole
                  ? "Find your next favorite"
                  : "Books in the catalog"}
              </h3>
            </div>
            <button className="text-button" onClick={() => goTo("Catalog")}>
              Browse all <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="featured-grid">
            {data.books
              .filter((book) => !book.deletedAt)
              .slice(0, 4)
              .map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  availability={bookAvailability(book)}
                  onDetails={() => {
                    setSelectedBook(book);
                    goTo("Catalog");
                  }}
                  onReserve={() =>
                    perform(
                      {
                        type: "reserve",
                        bookId: book.id,
                        ...(role === "Receptionist"
                          ? { memberId: selectedCustomerId }
                          : {}),
                      },
                      "Your reservation has been added to the queue.",
                    )
                  }
                  onBorrow={() =>
                    perform(
                      { type: "requestBorrow", bookId: book.id },
                      "Your borrow request has been sent.",
                    )
                  }
                  role={role}
                />
              ))}
          </div>
        </section>
      </>
    );
  }

  function renderCatalog() {
    if (selectedBook) {
      const book =
        data.books.find((item) => item.id === selectedBook.id) ?? selectedBook;
      const availabilityData = bookAvailability(book);
      const reviews = (data.reviews ?? []).filter((review) => review.bookId === book.id);
      const averageRating = reviews.length
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
        : 0;
      return (
        <section className="panel book-detail">
          <button className="back-link" onClick={() => setSelectedBook(null)}>
            ← Back to catalog
          </button>
          <div className="detail-grid">
            <BookCover book={book} />
            <div className="detail-copy">
              <div className="eyebrow">
                {book.category} · {book.condition} condition
              </div>
              <h2>{book.title}</h2>
              <p className="detail-author">by {book.author}</p>
              <div className="rating-line">
                <span className="stars">{"★".repeat(Math.round(averageRating))}{"☆".repeat(5 - Math.round(averageRating))}</span>
                <span>{averageRating.toFixed(1)} · {reviews.length} reviews</span>
              </div>
              <p className="detail-description">{book.description}</p>
              <div className="detail-facts">
                <div>
                  <span>Availability</span>
                  <StatusBadge
                    label={availabilityData.label}
                    tone={availabilityData.count > 0 ? "success" : "warning"}
                  />
                </div>
                <div>
                  <span>Copies available</span>
                  <strong>{availabilityData.count}</strong>
                </div>
                <div>
                  <span>ISBN</span>
                  <strong className="mono">{book.isbn}</strong>
                </div>
                <div>
                  <span>Bookshop price</span>
                  <strong>{money(book.price)}</strong>
                </div>
              </div>
              <div className="detail-actions">
                {(role === "Customer" || role === "Receptionist") && (
                  <button
                    className="button button-primary"
                    onClick={() =>
                      perform(
                        {
                          type: "reserve",
                          bookId: book.id,
                          ...(role === "Receptionist"
                            ? { memberId: selectedCustomerId }
                            : {}),
                        },
                        "Your reservation has been added to the queue.",
                      )
                    }
                  >
                    Reserve a copy
                  </button>
                )}
                {role === "Customer" && availabilityData.count > 0 && (
                  <button
                    className="button button-secondary"
                    onClick={() =>
                      perform(
                        { type: "requestBorrow", bookId: book.id },
                        "Your borrow request has been sent.",
                      )
                    }
                  >
                    Borrow request
                  </button>
                )}
              </div>
              <div className="review-preview">
                <h3>Reader notes</h3>
                {reviews.map((review) => (
                  <p key={review.id}>
                    <span className="stars">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>{" "}
                    {review.text} — {data.members.find((member) => member.id === review.memberId)?.name ?? "Reader"}
                    {role === "Manager" && (
                      <button className="tiny-button reject" onClick={() => void perform({ type: "deleteReview", reviewId: review.id }, "Review removed.")}>Remove</button>
                    )}
                  </p>
                ))}
                {role === "Customer" && !reviews.some((review) => review.memberId === customerId) && (
                  <form className="filter-panel" onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void perform({ type: "addReview", bookId: book.id, rating: Number(form.get("rating")), text: String(form.get("text") ?? "") }, "Review added.");
                    event.currentTarget.reset();
                  }}>
                    <label>Rating
                      <select name="rating" required defaultValue="5"><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select>
                    </label>
                    <label>Review
                      <input name="text" minLength={3} maxLength={2000} required />
                    </label>
                    <button className="button button-primary">Write a review</button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>
      );
    }
    return (
      <>
        {role === "Manager" && (
          <section className="panel">
            <div className="panel-heading">
              <div><div className="eyebrow">Catalog administration</div><h3>{editingBookId ? "Edit book" : "Add a book"}</h3></div>
              {editingBookId && <button className="text-button" onClick={() => { setEditingBookId(null); setCoverPreview(""); }}>Cancel edit</button>}
            </div>
            <form className="filter-panel" key={editingBookId ?? "new-book"} onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              const current = data.books.find((book) => book.id === editingBookId);
              const cover = coverPreview || String(values.get("cover") ?? current?.cover ?? "");
              if (cover.startsWith("data:image/") && cover.length > 2_800_000) {
                setError("Cover image must be 2 MB or smaller.");
                return;
              }
              void perform({ type: "saveBook", book: {
                id: current?.id,
                title: String(values.get("title") ?? ""),
                author: String(values.get("author") ?? ""),
                category: String(values.get("category") ?? ""),
                isbn: String(values.get("isbn") ?? ""),
                description: String(values.get("description") ?? ""),
                condition: String(values.get("condition") ?? "Good") as Book["condition"],
                price: Number(values.get("price")),
                quantity: Number(values.get("quantity")),
                cover,
                forSale: values.get("forSale") === "on",
                stockThreshold: Number(values.get("stockThreshold")) || 3,
                location: String(values.get("location") ?? "Library floor") as Book["location"],
              } }, current ? "Book updated." : "Book added.");
              setEditingBookId(null); setCoverPreview("");
            }}>
              <label>Title<input name="title" required maxLength={200} defaultValue={data.books.find((book) => book.id === editingBookId)?.title} /></label>
              <label>Author<input name="author" required maxLength={200} defaultValue={data.books.find((book) => book.id === editingBookId)?.author} /></label>
              <label>Category<select name="category" required defaultValue={data.books.find((book) => book.id === editingBookId)?.category ?? ""}><option value="" disabled>Select category</option>{(data.categories ?? []).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>ISBN<input name="isbn" required maxLength={32} defaultValue={data.books.find((book) => book.id === editingBookId)?.isbn} /></label>
              <label>Description<input name="description" maxLength={5000} defaultValue={data.books.find((book) => book.id === editingBookId)?.description} /></label>
              <label>Condition<select name="condition" defaultValue={data.books.find((book) => book.id === editingBookId)?.condition ?? "Good"}>{["New", "Good", "Fair", "Poor", "Damaged"].map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Price (₪)<input name="price" type="number" min="0" step="0.01" required defaultValue={data.books.find((book) => book.id === editingBookId)?.price ?? 0} /></label>
              <label>Quantity<input name="quantity" type="number" min="0" step="1" required defaultValue={data.books.find((book) => book.id === editingBookId)?.quantity ?? 0} /></label>
              <label>Low-stock threshold<input name="stockThreshold" type="number" min="1" defaultValue={data.books.find((book) => book.id === editingBookId)?.stockThreshold ?? 3} /></label>
              <label>Storage location<select name="location" defaultValue={data.books.find((book) => book.id === editingBookId)?.location ?? "Library floor"}><option>Library floor</option><option>Warehouse</option></select></label>
              <label>Cover image (JPG/PNG, max 2 MB)<input type="file" accept="image/jpeg,image/png" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024) {
                  setError("Choose a JPG or PNG image no larger than 2 MB.");
                  event.currentTarget.value = "";
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => setCoverPreview(String(reader.result));
                reader.onerror = () => setError("Could not read the selected cover image.");
                reader.readAsDataURL(file);
              }} /></label>
              {coverPreview && <img className="uploaded-cover-preview" src={coverPreview} alt="Selected book cover preview" />}
              <label className="checkbox-label"><input name="forSale" type="checkbox" defaultChecked={data.books.find((book) => book.id === editingBookId)?.forSale ?? true} /> For sale</label>
              <button className="button button-primary">{editingBookId ? "Save changes" : "Add book"}</button>
            </form>
            <form className="filter-panel" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void perform({ type: "addCategory", name: String(form.get("categoryName") ?? "") }, "Category added.");
              event.currentTarget.reset();
            }}>
              <label>New category<input name="categoryName" required minLength={2} maxLength={100} /></label>
              <button className="button button-secondary">Add category</button>
            </form>
            <div className="table-wrap"><table><thead><tr><th>BOOK</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
              {data.books.map((book) => <tr key={book.id}><td>{book.title}</td><td>{book.deletedAt ? "Deleted" : "Active"}</td><td className="row-actions">{book.deletedAt ? <button className="tiny-button approve" onClick={() => void perform({ type: "restoreBook", bookId: book.id }, "Book restored.")}>Restore</button> : <><button className="tiny-button approve" onClick={() => { setEditingBookId(book.id); setCoverPreview(""); }}>Edit</button><button className="tiny-button reject" onClick={() => { if (window.confirm(`Hide ${book.title} from the catalog?`)) void perform({ type: "deleteBook", bookId: book.id }, "Book hidden from the catalog."); }}>Delete</button></>}</td></tr>)}
            </tbody></table></div>
          </section>
        )}
        <section className="catalog-intro">
          <div>
            <div className="eyebrow">A world between the covers</div>
            <h2>Find a book to fall into.</h2>
            <p>
              Browse the collection, find a favorite, and let the next chapter
              begin.
            </p>
          </div>
          <div className="catalog-count">
            <strong>{filteredBooks.length}</strong>
            <span>books to explore</span>
          </div>
        </section>
        <section className="filter-panel">
          {role === "Receptionist" && (
            <label className="select-field">
              <span className="sr-only">Reservation customer</span>
              <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
                <option value="">Select customer</option>
                {data.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
          )}
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, author, category or ISBN…"
              aria-label="Search books"
            />
          </label>
          <label className="select-field">
            <span className="sr-only">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span className="sr-only">Availability</span>
            <select
              value={availability}
              onChange={(event) => setAvailability(event.target.value)}
            >
              <option>All availability</option>
              <option>Available</option>
              <option>Out of stock</option>
            </select>
          </label>
          <label className="select-field">
            <span className="sr-only">Sort by</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="title">Sort: Title</option>
              <option value="author">Sort: Author</option>
              <option value="rating">Sort: Rating</option>
              <option value="price">Sort: Price</option>
            </select>
          </label>
        </section>
        {filteredBooks.length ? (
          <div className="book-grid">
            {filteredBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                availability={bookAvailability(book)}
                onDetails={() => setSelectedBook(book)}
                onReserve={() =>
                  perform(
                    {
                      type: "reserve",
                      bookId: book.id,
                      ...(role === "Receptionist"
                        ? { memberId: selectedCustomerId }
                        : {}),
                    },
                    "Your reservation has been added to the queue.",
                  )
                }
                onBorrow={() =>
                  perform(
                    { type: "requestBorrow", bookId: book.id },
                    "Your borrow request has been sent.",
                  )
                }
                role={role}
              />
            ))}
          </div>
        ) : (
          <section className="panel">
            <EmptyState text="No books match those filters. Try adjusting your search." />
          </section>
        )}
      </>
    );
  }

  function renderCirculation() {
    const shownRequests =
      role === "Customer"
        ? data.requests.filter((request) => request.memberId === customerId)
        : data.requests;
    const shownLoans = role === "Customer" ? customerLoans : activeLoans;
    return (
      <div className="stacked-panels">
        {role === "Receptionist" && <section className="panel"><div className="eyebrow">Reception desk</div><h3>Issue a book directly</h3><form className="filter-panel" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void perform({ type: "checkoutLoan", memberId: String(form.get("memberId") ?? ""), bookId: String(form.get("bookId") ?? "") }, "Book issued and due date recorded.");
          event.currentTarget.reset();
        }}><label>Customer<select name="memberId" required><option value="">Select customer</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Available book<select name="bookId" required><option value="">Select book</option>{data.books.filter((book) => !book.deletedAt && bookAvailability(book).count > 0).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label><button className="button button-primary">Issue loan</button></form></section>}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Requests & approvals</div>
              <h3>Borrow requests</h3>
            </div>
            <span className="subtle-count">
              {shownRequests.filter((item) => item.status === "Pending").length}{" "}
              pending
            </span>
          </div>
          {shownRequests.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>REQUEST</th>
                    <th>READER</th>
                    <th>BOOK</th>
                    <th>REQUESTED</th>
                    <th>STATUS</th>
                    {role === "Receptionist" && <th>ACTIONS</th>}
                  </tr>
                </thead>
                <tbody>
                  {shownRequests.map((request) => {
                    const member = data.members.find(
                      (item) => item.id === request.memberId,
                    );
                    const book = data.books.find(
                      (item) => item.id === request.bookId,
                    );
                    return (
                      <tr key={request.id}>
                        <td className="mono">{request.id}</td>
                        <td>{member?.name}</td>
                        <td>{book?.title}</td>
                        <td>{dateLabel(request.requestedAt)}</td>
                        <td>
                          <StatusBadge
                            label={request.status}
                            tone={
                              request.status === "Pending"
                                ? "warning"
                                : request.status === "Approved"
                                  ? "success"
                                  : "danger"
                            }
                          />
                        </td>
                        {role === "Receptionist" && (
                          <td>
                            {request.status === "Pending" && (
                              <div className="row-actions">
                                <button
                                  className="tiny-button approve"
                                  onClick={() =>
                                    perform(
                                      {
                                        type: "approveRequest",
                                        requestId: request.id,
                                      },
                                      "Request approved and loan issued.",
                                    )
                                  }
                                >
                                  Approve
                                </button>
                                <button
                                  className="tiny-button reject"
                                  onClick={() =>
                                    perform(
                                      {
                                        type: "rejectRequest",
                                        requestId: request.id,
                                      },
                                      "Borrow request declined.",
                                    )
                                  }
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState text="There are no borrow requests here yet." />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Out in the world</div>
              <h3>
                {role === "Customer" ? "Your current loans" : "Active loans"}
              </h3>
            </div>
            <span className="subtle-count">{shownLoans.length} books</span>
          </div>
          {shownLoans.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>LOAN</th>
                    <th>READER</th>
                    <th>BOOK</th>
                    <th>ISSUED</th>
                    <th>DUE DATE</th>
                    <th>STATUS</th>
                    {(role === "Receptionist" || role === "Customer") && <th>ACTION</th>}
                  </tr>
                </thead>
                <tbody>
                  {shownLoans.map((loan) => {
                    const member = data.members.find(
                      (item) => item.id === loan.memberId,
                    );
                    const book = data.books.find(
                      (item) => item.id === loan.bookId,
                    );
                    const late = remainingDays(loan.dueAt) < 0;
                    return (
                      <tr key={loan.id}>
                        <td className="mono">{loan.id}</td>
                        <td>{member?.name}</td>
                        <td>{book?.title}</td>
                        <td>{dateLabel(loan.issuedAt)}</td>
                        <td>{dateLabel(loan.dueAt)}</td>
                        <td>
                          <StatusBadge
                            label={
                              late
                                ? `Overdue · ${Math.abs(remainingDays(loan.dueAt))}d`
                                : "On loan"
                            }
                            tone={late ? "danger" : "info"}
                          />
                        </td>
                        {(role === "Receptionist" || role === "Customer") && (
                          <td>
                            {role === "Receptionist" ? <button
                              className="tiny-button approve"
                              onClick={() =>
                                perform(
                                  { type: "returnLoan", loanId: loan.id, condition: returnConditions[loan.id] ?? "Good" },
                                  "Book returned and account updated.",
                                )
                              }
                            >
                              Record return ({returnConditions[loan.id] ?? "Good"})
                            </button> : (
                            !loan.renewals &&
                            !late &&
                            !(data.renewals ?? []).some((request) => request.loanId === loan.id && request.status === "Pending") && (
                              <button className="tiny-button approve" onClick={() => void perform({ type: "requestRenewal", loanId: loan.id }, "Renewal request sent to the receptionist.")}>Request renewal</button>
                            )
                            )}
                            {role === "Receptionist" && <select aria-label={`Return condition for ${book?.title ?? "book"}`} value={returnConditions[loan.id] ?? "Good"} onChange={(event) => setReturnConditions((current) => ({ ...current, [loan.id]: event.target.value as Book["condition"] }))}>
                              {["New", "Good", "Fair", "Poor", "Damaged"].map((condition) => <option key={condition}>{condition}</option>)}
                            </select>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState text="No active loans." />
          )}
        </section>
        <section className="panel"><div className="eyebrow">Circulation history</div><h3>Returned loans</h3>        {data.loans.some((loan) => loan.status === "Returned" && (role !== "Customer" || loan.memberId === customerId)) ? <div className="table-wrap"><table><thead><tr><th>LOAN</th><th>BOOK</th><th>ISSUED</th><th>DUE</th><th>RETURNED</th><th>FINE</th></tr></thead><tbody>{data.loans.filter((loan) => loan.status === "Returned" && (role !== "Customer" || loan.memberId === customerId)).map((loan) => <tr key={loan.id}><td>{loan.id}</td><td>{data.books.find((book) => book.id === loan.bookId)?.title}</td><td>{dateLabel(loan.issuedAt)}</td><td>{dateLabel(loan.dueAt)}</td><td>{loan.returnedAt ? dateLabel(loan.returnedAt) : "—"}</td><td>{money(Math.min(overdueDaysAt(loan.dueAt, loan.returnedAt ?? new Date()) * (data.settings?.finePerDay ?? 1), data.settings?.fineCapAtBookPrice === false ? Number.MAX_SAFE_INTEGER : data.books.find((book) => book.id === loan.bookId)?.price ?? 0))}</td></tr>)}</tbody></table></div> : <EmptyState text="No returned loans yet." />}</section>
        {role !== "Customer" && (data.renewals ?? []).some((item) => item.status === "Pending") && (
          <section className="panel">
            <div className="eyebrow">Loan extension approvals</div><h3>Renewal requests</h3>
            <div className="table-wrap"><table><thead><tr><th>REQUEST</th><th>CUSTOMER</th><th>BOOK</th><th>CURRENT DUE</th><th>PROPOSED DUE</th><th>ACTIONS</th></tr></thead><tbody>{(data.renewals ?? []).filter((item) => item.status === "Pending").map((request) => {
              const loan = data.loans.find((item) => item.id === request.loanId);
              const book = data.books.find((item) => item.id === loan?.bookId);
              const member = data.members.find((item) => item.id === loan?.memberId);
              return <tr key={request.id}><td>{request.id}</td><td>{member?.name}</td><td>{book?.title}</td><td>{loan ? dateLabel(loan.dueAt) : "—"}</td><td>{loan ? dateLabel(new Date(Date.parse(loan.dueAt) + (data.settings?.loanDays ?? 14) * 86_400_000).toISOString()) : "—"}</td><td className="row-actions"><button className="tiny-button approve" onClick={() => void perform({ type: "decideRenewal", requestId: request.id, approve: true }, "Loan renewal approved.")}>Approve</button><button className="tiny-button reject" onClick={() => void perform({ type: "decideRenewal", requestId: request.id, approve: false }, "Loan renewal rejected.")}>Reject</button></td></tr>;
            })}</tbody></table></div>
          </section>
        )}
      </div>
    );
  }

  function renderReservations() {
    const reservations = data.reservations
      .filter(
        (reservation) =>
          role !== "Customer" || reservation.memberId === customerId,
      )
      .slice()
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">Queue in request order</div>
            <h3>Reservations</h3>
          </div>
          {role === "Customer" && (
            <button
              className="button button-primary"
              onClick={() => goTo("Catalog")}
            >
              Find a book to reserve <span aria-hidden="true">→</span>
            </button>
          )}
          <span className="subtle-count">
            {
              reservations.filter((item) =>
                ["Queued", "Ready for pickup"].includes(item.status),
              ).length
            }{" "}
            active
          </span>
        </div>
        {reservations.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>RESERVATION</th>
                  <th>READER</th>
                  <th>BOOK</th>
                  <th>PLACED</th>
                  <th>PICKUP DEADLINE</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => {
                  const member = data.members.find(
                    (item) => item.id === reservation.memberId,
                  );
                  const book = data.books.find(
                    (item) => item.id === reservation.bookId,
                  );
                  const queuePosition =
                    role !== "Customer" && reservation.status === "Queued"
                      ? data.reservations
                          .filter(
                            (item) =>
                              item.bookId === reservation.bookId &&
                              item.status === "Queued" &&
                              Date.parse(item.createdAt) <=
                                Date.parse(reservation.createdAt),
                          )
                          .sort(
                            (first, second) =>
                              Date.parse(first.createdAt) -
                              Date.parse(second.createdAt),
                          )
                          .findIndex((item) => item.id === reservation.id) + 1
                      : null;
                  const expired =
                    reservation.holdUntil &&
                    Date.parse(reservation.holdUntil) < Date.now() &&
                    reservation.status === "Ready for pickup";
                  return (
                    <tr key={reservation.id}>
                      <td className="mono">{reservation.id}</td>
                      <td>{member?.name}</td>
                      <td>
                        {book?.title}
                        {queuePosition !== null && (
                          <small className="table-subtitle">
                            Queue position {queuePosition}
                          </small>
                        )}
                      </td>
                      <td>{dateLabel(reservation.createdAt)}</td>
                      <td>
                        {reservation.holdUntil
                          ? dateLabel(reservation.holdUntil)
                          : "—"}
                      </td>
                      <td>
                        <StatusBadge
                          label={expired ? "Expired" : reservation.status}
                          tone={
                            reservation.status === "Ready for pickup"
                              ? "success"
                              : reservation.status === "Queued"
                                ? "warning"
                                : "neutral"
                          }
                        />
                        {["Queued", "Ready for pickup"].includes(reservation.status) &&
                          (role === "Receptionist" || reservation.memberId === customerId) && (
                            <button className="tiny-button reject" onClick={() => void perform({ type: "cancelReservation", reservationId: reservation.id }, "Reservation cancelled.")}>Cancel</button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="There are no reservations yet." />
        )}
      </section>
    );
  }

  function renderInventory() {
    const movements = data.movements.filter((movement) => !movement.deletedAt);
    const deletedMovements = data.movements.filter((movement) => movement.deletedAt);
    return (
      <div className="stacked-panels">
        <div className="stat-grid three-stats">
          <article className="stat-card">
            <div className="stat-top">
              <span>Total titles</span>
              <span className="stat-icon">▤</span>
            </div>
            <strong>
              {data.books.filter((book) => !book.deletedAt).length}
            </strong>
            <small>In the collection</small>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <span>Low stock</span>
              <span className="stat-icon">⚑</span>
            </div>
            <strong>{lowStockBooks.length}</strong>
            <small>3 copies or fewer</small>
          </article>
          <article className="stat-card">
            <div className="stat-top">
              <span>Recent movements</span>
              <span className="stat-icon">↔</span>
            </div>
            <strong>{movements.length}</strong>
            <small>Recorded stock changes</small>
          </article>
        </div>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Collection health</div>
              <h3>Stock overview</h3>
            </div>
            <span className="subtle-count">Available copies</span>
          </div>
          {role !== "Warehouseman" && <form className="filter-panel" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void perform({
              type: "adjustStock",
              bookId: String(form.get("bookId") ?? ""),
              quantity: Number(form.get("quantity")),
              reason: String(form.get("reason") ?? ""),
            }, "Inventory adjustment recorded.");
            event.currentTarget.reset();
          }}>
            <label>Book<select name="bookId" required><option value="">Select a book</option>{data.books.filter((book) => !book.deletedAt).map((book) => <option key={book.id} value={book.id}>{book.title} · {book.quantity} copies</option>)}</select></label>
            <label>Quantity change (+/-)<input name="quantity" type="number" step="1" required /></label>
            <label>Reason<input name="reason" required minLength={3} maxLength={500} /></label>
            <button className="button button-secondary">Record adjustment</button>
          </form>}
          {(role === "Warehouseman" || role === "Manager") && <form className="filter-panel" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void perform({
              type: "recordStockLoss",
              bookId: String(form.get("bookId") ?? ""),
              quantity: Number(form.get("quantity")),
              lossType: String(form.get("lossType") ?? "Lost") as "Damaged" | "Lost",
              reason: String(form.get("reason") ?? ""),
            }, "Stock loss or damage recorded.");
            event.currentTarget.reset();
          }}>
            <label>Book<select name="bookId" required><option value="">Select a book</option>{data.books.filter((book) => !book.deletedAt).map((book) => <option key={book.id} value={book.id}>{book.title} · {book.quantity} copies</option>)}</select></label>
            <label>Record as<select name="lossType"><option value="Lost">Lost (remove from total stock)</option><option value="Damaged">Damaged (unavailable, retained in stock)</option></select></label>
            <label>Quantity<input name="quantity" type="number" min="1" step="1" required /></label>
            <label>Reason<input name="reason" required minLength={3} maxLength={500} /></label>
            <button className="button button-secondary">Record loss / damage</button>
          </form>}
          {(role === "Warehouseman" || role === "Manager") && <form className="filter-panel" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void perform({
              type: "transferStock",
              bookId: String(form.get("bookId") ?? ""),
              quantity: Number(form.get("quantity")),
              from: String(form.get("from") ?? "Warehouse") as "Warehouse" | "Library floor",
              to: String(form.get("to") ?? "Library floor") as "Warehouse" | "Library floor",
              reason: String(form.get("reason") ?? ""),
            }, "Stock transfer recorded.");
            event.currentTarget.reset();
          }}>
            <label>Book<select name="bookId" required><option value="">Select a book</option>{data.books.filter((book) => !book.deletedAt).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
            <label>From<select name="from"><option>Warehouse</option><option>Library floor</option></select></label>
            <label>To<select name="to"><option>Library floor</option><option>Warehouse</option></select></label>
            <label>Quantity<input name="quantity" type="number" min="1" step="1" required /></label>
            <label>Reason<input name="reason" required minLength={3} maxLength={500} /></label>
            <button className="button button-secondary">Transfer copies</button>
          </form>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>BOOK</th>
                  <th>ISBN</th>
                  <th>TOTAL COPIES</th>
                  <th>ON LOAN</th>
                  <th>AVAILABLE</th>
                  <th>WAREHOUSE</th>
                  <th>LIBRARY FLOOR</th>
                  <th>STOCK STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data.books
                  .filter((book) => !book.deletedAt)
                  .map((book) => {
                    const loanCount = activeLoans.filter(
                      (loan) => loan.bookId === book.id,
                    ).length;
                    const held = data.reservations.filter((reservation) =>
                      reservation.bookId === book.id &&
                      reservation.status === "Ready for pickup" &&
                      (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
                    ).length;
                    const count = book.quantity - loanCount - (book.damagedQuantity ?? 0) - held;
                    return (
                      <tr key={book.id}>
                        <td>
                          <div className="table-book">
                            <BookCover book={book} compact />
                            <div>
                              <strong>{book.title}</strong>
                              <small>{book.author}</small>
                            </div>
                          </div>
                        </td>
                        <td className="mono">{book.isbn}</td>
                        <td>{book.quantity}</td>
                        <td>{loanCount}</td>
                        <td>
                          <strong>{count}</strong>
                        </td>
                        <td>{book.stockByLocation?.Warehouse ?? (book.location === "Warehouse" ? book.quantity : 0)}</td>
                        <td>{book.stockByLocation?.["Library floor"] ?? (book.location === "Warehouse" ? 0 : book.quantity)}</td>
                        <td>
                          <StatusBadge
                            label={count <= (book.stockThreshold ?? data.settings?.lowStockThreshold ?? 3) ? "Low stock" : "Healthy"}
                            tone={count <= (book.stockThreshold ?? data.settings?.lowStockThreshold ?? 3) ? "warning" : "success"}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">Every change, accounted for</div>
              <h3>Stock movement history</h3>
            </div>
          </div>
          {movements.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MOVEMENT</th>
                    <th>BOOK</th>
                    <th>TYPE</th>
                    <th>AVAILABLE BEFORE</th>
                    <th>AVAILABLE AFTER</th>
                    <th>REASON</th>
                    <th>DATE</th>
                    {role === "Warehouseman" && <th>ACTION</th>}
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => {
                    const book = data.books.find(
                      (item) => item.id === movement.bookId,
                    );
                    return (
                      <tr key={movement.id}>
                        <td className="mono">{movement.id}</td>
                        <td>{book?.title}</td>
                        <td>{movement.type}</td>
                        <td>{movement.before}</td>
                        <td>{movement.after}</td>
                        <td>{movement.reason}</td>
                        <td>{dateLabel(movement.createdAt)}</td>
                        {role === "Warehouseman" && <td><button className="tiny-button reject" onClick={() => {
                          const reason = window.prompt("Why should this movement be hidden?");
                          if (reason) void perform({ type: "softDeleteMovement", movementId: movement.id, reason }, "Stock movement hidden.");
                        }}>Hide</button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState text="No stock changes have been recorded yet." />
          )}
          {role === "Manager" && deletedMovements.length > 0 && <div className="table-wrap"><h4>Hidden stock movements</h4><table><thead><tr><th>MOVEMENT</th><th>BOOK</th><th>REASON</th><th>ACTION</th></tr></thead><tbody>{deletedMovements.map((movement) => <tr key={movement.id}><td>{movement.id}</td><td>{data.books.find((book) => book.id === movement.bookId)?.title}</td><td>{movement.reason}</td><td><button className="tiny-button approve" onClick={() => void perform({ type: "restoreMovement", movementId: movement.id }, "Stock movement restored.")}>Restore</button></td></tr>)}</tbody></table></div>}
        </section>
      </div>
    );
  }

  function renderCustomers() {
    return (
      <div className="stacked-panels">
      {(role === "Manager" || role === "Receptionist") && <section className="panel"><div className="eyebrow">Member records</div><h3>{memberEditing ? "Edit member" : "Register member"}</h3><form className="filter-panel" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const expires = new Date(`${String(form.get("expiresAt") ?? "")}T12:00:00.000Z`).toISOString();
        void perform({ type: "saveMember", member: {
          ...(memberEditing ? { id: memberEditing.id } : {}),
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          phone: String(form.get("phone") ?? ""),
          membershipStatus: String(form.get("status") ?? "Pending") as Member["membershipStatus"],
          membershipExpiresAt: expires,
        } }, memberEditing ? "Member record updated." : "Member registered.");
        setMemberEditing(null);
        event.currentTarget.reset();
      }}>
        <label>Full name<input name="name" required minLength={2} maxLength={100} defaultValue={memberEditing?.name ?? ""} /></label>
        <label>Email<input name="email" type="email" required defaultValue={memberEditing?.email ?? ""} /></label>
        <label>Phone<input name="phone" required minLength={6} maxLength={30} defaultValue={memberEditing?.phone ?? ""} /></label>
        <label>Membership status<select name="status" defaultValue={memberEditing?.membershipStatus ?? "Pending"}><option>Pending</option><option>Active</option><option>Expired</option></select></label>
        <label>Expires on<input name="expiresAt" type="date" required defaultValue={(memberEditing?.membershipExpiresAt ?? new Date(Date.now() + 365 * 86_400_000).toISOString()).slice(0, 10)} /></label>
        <button className="button button-primary">{memberEditing ? "Save member" : "Register member"}</button>
        {memberEditing && <button type="button" className="button button-secondary" onClick={() => setMemberEditing(null)}>Cancel edit</button>}
      </form></section>}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">People who make this place</div>
            <h3>Members & memberships</h3>
          </div>
          <span className="subtle-count">{data.members.length} members</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>MEMBER</th>
                <th>CONTACT</th>
                <th>MEMBERSHIP</th>
                <th>EXPIRES</th>
                <th>ACTIVE LOANS</th>
                <th>OUTSTANDING FINES</th>
                {(role === "Manager" || role === "Receptionist") && (
                  <th>ACTIONS</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="member-cell">
                      <span className="avatar">
                        {member.name
                          .split(" ")
                          .map((part) => part[0])
                          .join("")}
                      </span>
                      <strong>{member.name}</strong>
                    </div>
                  </td>
                  <td>
                    {member.email}
                    <small className="table-subtitle">{member.phone}</small>
                  </td>
                  <td>
                    <StatusBadge
                      label={member.membershipStatus}
                      tone={
                        member.membershipStatus === "Active"
                          ? "success"
                          : "warning"
                      }
                    />
                  </td>
                  <td>{dateLabel(member.membershipExpiresAt)}</td>
                  <td>
                    {
                      activeLoans.filter((loan) => loan.memberId === member.id)
                        .length
                    }
                  </td>
                  <td>{money(member.unpaidFines)}</td>
                  {(role === "Manager" || role === "Receptionist") && (
                    <td>
                      {member.membershipStatus === "Pending" && (
                        <button
                          className="tiny-button approve"
                          onClick={() =>
                            perform(
                              {
                                type: "approveMembership",
                                memberId: member.id,
                              },
                              "Membership approved.",
                            )
                          }
                        >
                          Approve membership
                        </button>
                      )}
                      <button className="tiny-button approve" onClick={() => setMemberEditing(member)}>Edit</button>
                      {member.unpaidFines > 0 && <button className="tiny-button approve" onClick={() => {
                        const entered = window.prompt(`Cash fine payment for ${member.name}. Outstanding balance: ${money(member.unpaidFines)}. Enter amount received:`, member.unpaidFines.toFixed(2));
                        if (entered === null) return;
                        const amount = Number(entered);
                        if (!Number.isFinite(amount) || amount <= 0 || amount > member.unpaidFines) {
                          setError("Enter a valid cash amount no greater than the outstanding fine balance.");
                          return;
                        }
                        void perform({ type: "collectFinePayment", memberId: member.id, amount }, "Cash fine payment recorded.");
                      }}>Record cash fine payment</button>}
                      {role === "Manager" && <button className="tiny-button reject" onClick={() => {
                        const delta = window.prompt(`Current unpaid fines: ${money(member.unpaidFines)}. Enter adjustment (+ adds, - waives):`, "0");
                        if (delta === null) return;
                        const reason = window.prompt("Reason for this fine adjustment:");
                        if (reason === null) return;
                        void perform({ type: "adjustFine", memberId: member.id, amount: Number(delta), reason }, "Fine balance adjusted.");
                      }}>Adjust fine</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    );
  }

  function renderSettings() {
    const settings = { ...data.settings! };
    return (
      <div className="settings-grid">
        <section className="panel settings-panel">
          <div className="eyebrow">Editable library policies</div>
          <h3>System settings</h3>
          <form className="settings-form" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void perform({
              type: "updateSettings",
              settings: {
                loanDays: Number(form.get("loanDays")),
                finePerDay: Number(form.get("finePerDay")),
                fineCapAtBookPrice: form.get("fineCap") === "on",
                membershipDays: Number(form.get("membershipDays")),
                membershipFee: Number(form.get("membershipFee")),
                reservationHoldDays: Number(form.get("reservationHoldDays")),
                maxLoans: Number(form.get("maxLoans")),
                maxReservations: Number(form.get("maxReservations")),
                lowStockThreshold: Number(form.get("lowStockThreshold")),
                staffTimeoutMinutes: Number(form.get("staffTimeoutMinutes")),
                customerTimeoutMinutes: Number(form.get("customerTimeoutMinutes")),
                branchAddress: String(form.get("branchAddress") ?? ""),
                contactEmail: String(form.get("contactEmail") ?? ""),
                contactPhone: String(form.get("contactPhone") ?? ""),
                openingHours: String(form.get("openingHours") ?? ""),
              },
            }, "Library policies updated.");
          }}>
            {([
              ["loanDays", "Loan duration (days)", settings.loanDays],
              ["finePerDay", "Fine per overdue day (₪)", settings.finePerDay],
              ["membershipDays", "Membership duration (days)", settings.membershipDays],
              ["membershipFee", "Membership fee (₪)", settings.membershipFee],
              ["reservationHoldDays", "Reservation pickup hold (days)", settings.reservationHoldDays],
              ["maxLoans", "Maximum active loans", settings.maxLoans],
              ["maxReservations", "Maximum active reservations", settings.maxReservations],
              ["lowStockThreshold", "Low-stock threshold", settings.lowStockThreshold],
              ["staffTimeoutMinutes", "Staff session timeout (minutes)", settings.staffTimeoutMinutes],
              ["customerTimeoutMinutes", "Customer session timeout (minutes)", settings.customerTimeoutMinutes],
            ] as const).map(([name, label, value]) => <label key={name}>{label}<input name={name} type="number" min="0" step={name === "finePerDay" || name === "membershipFee" ? "0.01" : "1"} required defaultValue={value} /></label>)}
            <label>Public branch address<input name="branchAddress" maxLength={500} defaultValue={settings.branchAddress} /></label>
            <label>Public contact email<input name="contactEmail" type="email" maxLength={254} defaultValue={settings.contactEmail} /></label>
            <label>Public contact phone<input name="contactPhone" maxLength={50} defaultValue={settings.contactPhone} /></label>
            <label>Opening hours<input name="openingHours" maxLength={500} defaultValue={settings.openingHours} placeholder="For example: Sun–Thu, 9:00–17:00" /></label>
            <label className="checkbox-label"><input type="checkbox" name="fineCap" defaultChecked={settings.fineCapAtBookPrice} /> Cap each overdue fine at book price</label>
            <button className="button button-primary">Save settings</button>
          </form>
        </section>
        <section className="panel settings-panel">
          <div className="eyebrow">Circulation policies</div>
          <h3>Borrowing & reservations</h3>
          <p>
            These are the default rules configured in the SRS for this
            prototype.
          </p>
          <div className="setting-row">
            <div>
              <strong>Loan period</strong>
              <span>Time a book can be borrowed</span>
            </div>
            <b>{settings.loanDays} days</b>
          </div>
          <div className="setting-row">
            <div>
              <strong>Maximum active loans</strong>
              <span>Per customer at one time</span>
            </div>
            <b>{settings.maxLoans} books</b>
          </div>
          <div className="setting-row">
            <div>
              <strong>Maximum reservations</strong>
              <span>Active reservations per customer</span>
            </div>
            <b>{settings.maxReservations} books</b>
          </div>
          <div className="setting-row">
            <div>
              <strong>Reservation pickup hold</strong>
              <span>Calendar days after a book is ready</span>
            </div>
            <b>{settings.reservationHoldDays} days</b>
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="eyebrow">Fees & membership</div>
          <h3>Fine & membership defaults</h3>
          <p>
            Changes to these values require a production service and manager
            audit trail.
          </p>
          <div className="setting-row">
            <div>
              <strong>Overdue fine</strong>
              <span>Per book, per overdue day</span>
            </div>
            <b>{money(settings.finePerDay)}</b>
          </div>
          <div className="setting-row">
            <div>
              <strong>Fine cap</strong>
              <span>Maximum fine per book</span>
            </div>
            <b>Book price</b>
          </div>
          <div className="setting-row">
            <div>
              <strong>Borrow restriction</strong>
              <span>When outstanding fines exceed</span>
            </div>
            <b>₪ 10.00</b>
          </div>
          <div className="setting-row">
            <div>
              <strong>Low-stock alert</strong>
              <span>Available quantity threshold</span>
            </div>
            <b>{settings.lowStockThreshold} copies</b>
          </div>
        </section>
        <section className="prototype-note">
          <span>i</span>
          <div>
            <strong>Database-backed application</strong>
            <p>
              Production data is stored in Supabase PostgreSQL. Password-reset
              email needs provider configuration. Scheduled off-site backups
              and disaster recovery depend on the production hosting setup.
            </p>
          </div>
        </section>
        {role === "Manager" && <section className="panel settings-panel">
          <div className="eyebrow">Data protection</div><h3>Backup &amp; restore library records</h3>
          <p>Download a JSON export of library records for safekeeping. User accounts and password hashes are never included. The file itself is not encrypted; keep it in a restricted, encrypted location.</p>
          <div className="row-actions">
            <button className="button button-primary" onClick={async () => {
              try {
                const contents = prototypeMode
                  ? JSON.stringify({ version: 1, createdAt: new Date().toISOString(), state: await getPrototypeLibrary() }, null, 2)
                  : await (async () => {
                    const response = await fetch("/api/admin/backup", { cache: "no-store" });
                    if (!response.ok) {
                      const result = await response.json();
                      throw new Error(result.error ?? "Backup could not be downloaded.");
                    }
                    return await response.text();
                  })();
                const blob = new Blob([contents], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `shelf-and-soul-backup-${new Date().toISOString().slice(0, 10)}.json`;
                anchor.click();
                URL.revokeObjectURL(url);
              } catch (backupError) {
                setError(backupError instanceof Error ? backupError.message : "Backup could not be downloaded.");
              }
            }}>Download backup</button>
            <label className="button button-secondary">Restore backup<input type="file" accept="application/json,.json" hidden onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              if (!window.confirm("Restore this backup? Current library records will be replaced. User accounts are not changed.")) return;
              try {
                const backup = JSON.parse(await file.text()) as unknown;
                if (prototypeMode) {
                  setLibrary(await restorePrototypeLibrary(backup));
                  setToast("Library records restored. Prototype user accounts were not changed.");
                  return;
                }
                const response = await fetch("/api/admin/backup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ confirmation: "RESTORE_LIBRARY_DATA", backup }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error ?? "Could not restore this backup.");
                setToast(result.message);
                await refreshLibrary();
              } catch (backupError) {
                setError(backupError instanceof Error ? backupError.message : "Could not restore this backup.");
              }
            }} /></label>
          </div>
        </section>}
      </div>
    );
  }

  function renderProfile() {
    const member = currentMember;
    const user = authUser!;
    return (
      <section className="panel settings-panel">
        <div className="eyebrow">Your account</div>
        <h3>Profile</h3>
        <>
            <form className="settings-form" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void perform({ type: "updateProfile", name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), phone: String(form.get("phone") ?? "") }, "Profile updated.");
            }}>
              <label>Full name<input name="name" required minLength={2} maxLength={100} defaultValue={member?.name ?? user.name} /></label>
              <label>Email address<input name="email" type="email" required maxLength={254} defaultValue={member?.email ?? user.email} /></label>
              <label>Phone number<input name="phone" required minLength={6} maxLength={30} defaultValue={member?.phone ?? user.phone} /></label>
              <button className="button button-primary">Save profile</button>
            </form>
            {role === "Customer" && member && <>
              <div className="setting-row"><div><strong>Membership status</strong><span>Membership expiry {dateLabel(member.membershipExpiresAt)}</span></div><StatusBadge label={member.membershipStatus} tone={member.membershipStatus === "Active" ? "success" : "warning"} /></div>
              <div className="setting-row"><div><strong>Outstanding fines</strong><span>Pay cash at the library counter; staff will record the payment.</span></div><b>{money(member.unpaidFines)}</b></div>
            </>}
        </>
      </section>
    );
  }

  function renderSales() {
    const memberId = role === "Customer" ? customerId : selectedCustomerId;
    const customerSales = (data.sales ?? []).filter((sale) => role !== "Customer" || sale.memberId === customerId);
    const selectedSaleBook = data.books.find((book) => book.id === saleBookId);
    const selectedSaleBookAvailable = selectedSaleBook
      ? bookAvailability(selectedSaleBook).count
      : 0;
    const cartTotal = cart.reduce((sum, item) => {
      const book = data.books.find((entry) => entry.id === item.bookId);
      return sum + (book?.price ?? 0) * item.quantity;
    }, 0);
    return (
      <div className="stacked-panels">
        <section className="panel">
          <div className="panel-heading"><div><div className="eyebrow">{role === "Customer" ? "Library pickup only" : "Cash register"}</div><h3>{role === "Customer" ? "Bookshop" : "Record a sale"}</h3></div></div>
          {role !== "Customer" && <label>Customer<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="">Select customer</option>{data.members.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select></label>}
          <div className="filter-panel">
            <label>Book<select value={saleBookId} onChange={(event) => setSaleBookId(event.target.value)}><option value="">Select for-sale book</option>{data.books.filter((book) => !book.deletedAt && book.forSale && book.price > 0 && bookAvailability(book).count > 0).map((book) => <option key={book.id} value={book.id}>{book.title} · {money(book.price)} · {bookAvailability(book).count} available</option>)}</select></label>
            <label>Quantity<input type="number" min="1" step="1" max={selectedSaleBookAvailable || undefined} value={saleQuantity} onChange={(event) => setSaleQuantity(Number(event.target.value))} /></label>
            <button className="button button-secondary" disabled={!saleBookId || !Number.isInteger(saleQuantity) || saleQuantity < 1} onClick={() => {
              const book = data.books.find((item) => item.id === saleBookId);
              const available = book ? bookAvailability(book).count : 0;
              const cartQuantity = cart.find((item) => item.bookId === saleBookId)?.quantity ?? 0;
              if (!book || !book.forSale || book.price <= 0 || cartQuantity + saleQuantity > available) {
                setError("There is not enough available stock for this quantity.");
                return;
              }
              setError("");
              setCart((items) => {
                const existing = items.find((item) => item.bookId === saleBookId);
                return existing
                  ? items.map((item) => item.bookId === saleBookId ? { ...item, quantity: item.quantity + saleQuantity } : item)
                  : [...items, { bookId: saleBookId, quantity: saleQuantity }];
              });
            }}>Add to cart</button>
          </div>
          {cart.length > 0 && <>
            <div className="table-wrap"><table><thead><tr><th>BOOK</th><th>QUANTITY</th><th>ITEM TOTAL</th><th>ACTION</th></tr></thead><tbody>{cart.map((item) => {
              const book = data.books.find((entry) => entry.id === item.bookId);
              return <tr key={item.bookId}><td>{book?.title}</td><td>{item.quantity}</td><td>{money((book?.price ?? 0) * item.quantity)}</td><td><button className="tiny-button reject" onClick={() => setCart((items) => items.filter((entry) => entry.bookId !== item.bookId))}>Remove</button></td></tr>;
            })}</tbody></table></div>
            <div className="setting-row"><strong>Order total</strong><b>{money(cartTotal)}</b></div>
            <button className="button button-primary" disabled={!memberId} onClick={async () => {
              const ok = await perform({
                type: "createSale",
                items: cart,
                paymentMethod: role === "Customer" ? "Cash on pickup" : "Cash",
                ...(role === "Customer" ? {} : { customerId: memberId }),
              }, role === "Customer" ? "Pickup order placed. Pay cash when you collect it; staff will confirm payment." : "Cash sale recorded and receipt issued.");
              if (ok) setCart([]);
            }}>{role === "Customer" ? "Place cash-on-pickup order" : "Complete cash sale"}</button>
            {role === "Customer" && <p className="helper-text">No online payment is taken. Pay the displayed total in cash when collecting your order.</p>}
            {!memberId && <p className="field-error">Select a customer before completing the sale.</p>}
          </>}
        </section>
        <section className="panel"><div className="panel-heading"><div><div className="eyebrow">Receipts & orders</div><h3>Sales</h3></div></div>
          {customerSales.length ? <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>ITEMS</th><th>TOTAL</th><th>PAYMENT METHOD</th><th>PAYMENT</th><th>ORDER</th><th>ACTIONS</th></tr></thead><tbody>{customerSales.map((sale) => <tr key={sale.id}><td className="mono">{sale.id}</td><td>{data.members.find((item) => item.id === sale.memberId)?.name}</td><td>{dateLabel(sale.createdAt)}</td><td>{sale.items.map((item) => `${data.books.find((book) => book.id === item.bookId)?.title ?? "Book"} × ${item.quantity}`).join(", ")}</td><td>{money(sale.total)}</td><td>{sale.paymentMethod}</td><td><StatusBadge label={sale.paymentStatus ?? "Paid"} tone={sale.paymentStatus === "Unpaid" ? "warning" : "success"} /></td><td><StatusBadge label={sale.status} tone={sale.status === "Ready" || sale.status === "Collected" ? "success" : sale.status === "Pending" ? "warning" : "neutral"} /></td><td className="row-actions"><button className="tiny-button approve" onClick={() => window.print()}>Print receipt</button>{role === "Customer" && sale.paymentMethod === "Cash on pickup" && sale.status === "Pending" && <button className="tiny-button reject" onClick={() => void perform({ type: "updateOrder", orderId: sale.id, status: "Cancelled" }, "Order cancelled; stock was returned.")}>Cancel order</button>}{role !== "Customer" && sale.paymentMethod === "Cash on pickup" && sale.status === "Pending" && <button className="tiny-button approve" onClick={() => void perform({ type: "updateOrder", orderId: sale.id, status: "Ready" }, "Order marked ready for cash-on-pickup collection.")}>Mark ready for pickup</button>}{role !== "Customer" && sale.paymentMethod === "Cash on pickup" && sale.status === "Ready" && <button className="tiny-button approve" onClick={() => void perform({ type: "updateOrder", orderId: sale.id, status: "Collected" }, "Pickup completed and cash payment confirmed.")}>Confirm cash &amp; complete pickup</button>}</td></tr>)}</tbody></table></div> : <EmptyState text="No sales or receipts are available." />}
        </section>
      </div>
    );
  }

  function renderSuppliers() {
    const suppliers = data.suppliers ?? [];
    const orders = data.purchaseOrders ?? [];
    const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierEditingId);
    return <div className="stacked-panels">
      {role === "Manager" && <section className="panel"><div className="eyebrow">Supplier directory</div><h3>{selectedSupplier ? "Edit supplier" : "Add supplier"}</h3><form key={selectedSupplier?.id ?? "new-supplier"} className="filter-panel" onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void perform({ type: "saveSupplier", supplier: { ...(selectedSupplier ? { id: selectedSupplier.id } : {}), name: String(form.get("name") ?? ""), phone: String(form.get("phone") ?? ""), address: String(form.get("address") ?? "") } }, "Supplier saved.");
        setSupplierEditingId("");
        event.currentTarget.reset();
      }}><label>Name<input name="name" required maxLength={200} defaultValue={selectedSupplier?.name ?? ""} /></label><label>Phone<input name="phone" required maxLength={50} defaultValue={selectedSupplier?.phone ?? ""} /></label><label>Address<input name="address" required maxLength={500} defaultValue={selectedSupplier?.address ?? ""} /></label><button className="button button-primary">Save supplier</button>{selectedSupplier && <button type="button" className="button button-secondary" onClick={() => setSupplierEditingId("")}>Cancel edit</button>}</form></section>}
      <section className="panel"><div className="eyebrow">Supplier contacts</div><h3>Suppliers</h3>{suppliers.length ? <div className="table-wrap"><table><thead><tr><th>SUPPLIER</th><th>PHONE</th><th>ADDRESS</th>{role === "Manager" && <th>ACTION</th>}</tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id}><td>{supplier.name}</td><td>{supplier.phone}</td><td>{supplier.address}</td>{role === "Manager" && <td><button className="tiny-button approve" onClick={() => setSupplierEditingId(supplier.id)}>Edit</button></td>}</tr>)}</tbody></table></div> : <EmptyState text="No suppliers have been added yet." />}</section>
      <section className="panel"><div className="eyebrow">Purchase suggestions</div><h3>{role === "Warehouseman" ? "Suggest a purchase order" : "Purchase orders"}</h3>
        {suppliers.length > 0 && <form className="filter-panel" onSubmit={(event) => {
          event.preventDefault(); const form = new FormData(event.currentTarget);
          void perform({ type: "createPurchaseOrder", supplierId: String(form.get("supplierId") ?? ""), items: [{ bookId: String(form.get("bookId") ?? ""), quantity: Number(form.get("quantity")), unitPrice: Number(form.get("unitPrice")) }] }, "Purchase order suggestion submitted for manager approval.");
          event.currentTarget.reset();
        }}><label>Supplier<select name="supplierId" required><option value="">Choose supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Book<select name="bookId" required><option value="">Choose book</option>{data.books.filter((book) => !book.deletedAt).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label><label>Quantity<input name="quantity" type="number" min="1" required defaultValue="1" /></label><label>Unit price (₪)<input name="unitPrice" type="number" min="0" step="0.01" required /></label><button className="button button-primary">Submit suggestion</button></form>}
        {orders.length ? <div className="table-wrap"><table><thead><tr><th>PO</th><th>SUPPLIER</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td>{order.id}</td><td>{suppliers.find((item) => item.id === order.supplierId)?.name}</td><td>{order.items.map((item) => `${data.books.find((book) => book.id === item.bookId)?.title ?? "Book"} × ${item.quantity}`).join(", ")}</td><td>{money(order.total)}</td><td>{order.status}</td><td className="row-actions">{role === "Manager" && order.status === "Suggested" && <><button className="tiny-button approve" onClick={() => void perform({ type: "decidePurchaseOrder", orderId: order.id, status: "Approved" }, "Purchase order approved.")}>Approve</button><button className="tiny-button reject" onClick={() => void perform({ type: "decidePurchaseOrder", orderId: order.id, status: "Cancelled" }, "Purchase order cancelled.")}>Cancel</button></>}{role === "Manager" && order.status === "Approved" && <button className="tiny-button approve" onClick={() => void perform({ type: "decidePurchaseOrder", orderId: order.id, status: "Sent" }, "Approved purchase order marked sent.")}>Mark sent</button>}{role === "Warehouseman" && order.status === "Sent" && <button className="tiny-button approve" onClick={() => { const invoiceNumber = window.prompt("Enter the supplier invoice number:"); if (invoiceNumber?.trim()) void perform({ type: "receivePurchaseOrder", orderId: order.id, invoiceNumber: invoiceNumber.trim() }, "Purchase order received and invoice recorded."); }}>Receive &amp; record invoice</button>}</td></tr>)}</tbody></table></div> : <EmptyState text="No purchase orders yet." />}
      </section>
      <section className="panel"><div className="eyebrow">Accounts payable</div><h3>Supplier invoices</h3>{(data.invoices ?? []).length ? <div className="table-wrap"><table><thead><tr><th>INVOICE</th><th>PO</th><th>SUPPLIER</th><th>TOTAL</th><th>RECEIVED</th><th>RECORDED BY</th></tr></thead><tbody>{data.invoices!.map((invoice) => <tr key={invoice.id}><td>{invoice.invoiceNumber}</td><td>{invoice.purchaseOrderId}</td><td>{suppliers.find((supplier) => supplier.id === invoice.supplierId)?.name ?? "Supplier"}</td><td>{money(invoice.total)}</td><td>{dateLabel(invoice.receivedAt)}</td><td>{invoice.receivedBy}</td></tr>)}</tbody></table></div> : <EmptyState text="Supplier invoices will appear here when sent purchase orders are received." />}</section>
    </div>;
  }

  function renderReports() {
    const canSeeCirculation = role !== "Warehouseman";
    const selectedReport = role === "Warehouseman" ? "inventory" : reportKind;
    const loanReportRows = data.loans.filter((loan) => loan.status === "Active").map((loan) => ({
      loan: loan.id,
      book: data.books.find((book) => book.id === loan.bookId)?.title ?? "",
      member: data.members.find((member) => member.id === loan.memberId)?.name ?? "",
      issued: loan.issuedAt,
      due: loan.dueAt,
      status: loan.status,
    }));
    const returnReportRows = data.loans.filter((loan) => loan.status === "Returned").map((loan) => ({
      loan: loan.id,
      book: data.books.find((book) => book.id === loan.bookId)?.title ?? "",
      member: data.members.find((member) => member.id === loan.memberId)?.name ?? "",
      issued: loan.issuedAt,
      returned: loan.returnedAt ?? "",
      fine: Math.min(overdueDaysAt(loan.dueAt, loan.returnedAt ?? new Date()) * (data.settings?.finePerDay ?? 1), data.settings?.fineCapAtBookPrice === false ? Number.MAX_SAFE_INTEGER : data.books.find((book) => book.id === loan.bookId)?.price ?? 0),
    }));
    const reportRows: Record<string, string | number>[] = selectedReport === "inventory"
      ? data.books.filter((book) => !book.deletedAt).map((book) => ({
          title: book.title,
          quantity: book.quantity,
          damaged: book.damagedQuantity ?? 0,
          available: Math.max(0, book.quantity - activeLoans.filter((loan) => loan.bookId === book.id).length - (book.damagedQuantity ?? 0) - data.reservations.filter((reservation) => reservation.bookId === book.id && reservation.status === "Ready for pickup" && (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now())).length),
          warehouse: book.stockByLocation?.Warehouse ?? (book.location === "Warehouse" ? book.quantity : 0),
          libraryFloor: book.stockByLocation?.["Library floor"] ?? (book.location === "Warehouse" ? 0 : book.quantity),
        }))
      : selectedReport === "sales"
        ? (data.sales ?? []).map((sale) => ({ invoice: sale.id, customer: data.members.find((member) => member.id === sale.memberId)?.name ?? "", date: sale.createdAt, total: sale.total, method: sale.paymentMethod, status: sale.status }))
        : selectedReport === "loans"
          ? loanReportRows
          : selectedReport === "returns"
            ? returnReportRows
            : data.members.filter((member) => member.unpaidFines > 0).map((member) => ({ member: member.name, email: member.email, unpaidFine: member.unpaidFines, status: member.membershipStatus }));
    const filteredRows = reportRows.filter((row) => {
      const dateValue = String(row.date ?? row.returned ?? row.issued ?? "");
      if (!dateValue) return selectedReport === "inventory" || selectedReport === "fines";
      const time = Date.parse(dateValue);
      return (!reportFrom || time >= Date.parse(`${reportFrom}T00:00:00`)) &&
        (!reportTo || time <= Date.parse(`${reportTo}T23:59:59.999`));
    });
    const csv = filteredRows.length
      ? [Object.keys(filteredRows[0]!).join(","), ...filteredRows.map((row) => Object.values(row).map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))].join("\r\n")
      : "No report data";
    return <section className="panel"><div className="panel-heading"><div><div className="eyebrow">Printable and exportable</div><h3>{selectedReport[0]!.toUpperCase() + selectedReport.slice(1)} report</h3></div><div className="row-actions"><button className="button button-secondary" onClick={() => window.print()}>Print / Save PDF</button><button className="button button-primary" onClick={() => downloadCsv(`shelf-and-soul-${selectedReport}-report.csv`, csv)}>Export CSV</button></div></div>
      <div className="filter-panel">{canSeeCirculation && <label>Report<select value={reportKind} onChange={(event) => setReportKind(event.target.value as typeof reportKind)}><option value="sales">Sales</option><option value="loans">Active loans</option><option value="returns">Returns</option><option value="fines">Outstanding fines</option><option value="inventory">Inventory</option></select></label>}<label>From<input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} /></label><label>To<input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} /></label><button className="button button-secondary" onClick={() => { setReportFrom(""); setReportTo(""); }}>Clear date filters</button></div>
      {filteredRows.length ? <div className="table-wrap"><table><thead><tr>{Object.keys(filteredRows[0]!).map((key) => <th key={key}>{key.toUpperCase()}</th>)}</tr></thead><tbody>{filteredRows.map((row, index) => <tr key={index}>{Object.values(row).map((value, cell) => <td key={cell}>{String(value)}</td>)}</tr>)}</tbody></table></div> : <EmptyState text="There are no records to include in this report." />}</section>;
  }

  function renderAudit() {
    const query = auditQuery.trim().toLowerCase();
    const entries = (data.auditLog ?? []).filter((entry) => {
      const time = Date.parse(entry.createdAt);
      const matchesQuery = !query || `${entry.actor} ${entry.action} ${entry.item}`.toLowerCase().includes(query);
      const matchesFrom = !auditFrom || time >= Date.parse(`${auditFrom}T00:00:00`);
      const matchesTo = !auditTo || time <= Date.parse(`${auditTo}T23:59:59.999`);
      return matchesQuery && matchesFrom && matchesTo;
    });
    return <section className="panel"><div className="panel-heading"><div><div className="eyebrow">Read-only history</div><h3>Audit log</h3></div></div><div className="filter-panel"><label>Search<input type="search" value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} placeholder="User, action, or affected item" /></label><label>From<input type="date" value={auditFrom} max={auditTo || undefined} onChange={(event) => setAuditFrom(event.target.value)} /></label><label>To<input type="date" value={auditTo} min={auditFrom || undefined} onChange={(event) => setAuditTo(event.target.value)} /></label><button className="button button-secondary" onClick={() => { setAuditQuery(""); setAuditFrom(""); setAuditTo(""); }}>Clear filters</button></div>{entries.length ? <div className="table-wrap"><table><thead><tr><th>USER</th><th>ACTION</th><th>AFFECTED ITEM</th><th>DATE & TIME</th><th>BEFORE</th><th>AFTER</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{entry.actor}</td><td>{entry.action}</td><td>{entry.item}</td><td>{dateLabel(entry.createdAt)}</td><td>{entry.before ?? "—"}</td><td>{entry.after ?? "—"}</td></tr>)}</tbody></table></div> : <EmptyState text={query || auditFrom || auditTo ? "No audit events match these filters." : "No audit events have been recorded yet."} />}</section>;
  }

  function renderStaff() {
    const permissionModules = [
      ["catalog", "Catalog"],
      ["loans", "Loans & circulation"],
      ["reservations", "Reservations"],
      ["sales", "Sales"],
      ["fines", "Fines"],
      ["inventory", "Inventory"],
      ["purchasing", "Suppliers & purchasing"],
      ["reviews", "Reviews"],
      ["memberships", "Memberships"],
      ["notifications", "Notifications"],
      ["profile", "Profile"],
      ["settings", "System settings"],
    ] as const;

    async function saveStaff(input: {
      userId?: string;
      name: string;
      email: string;
      phone: string;
      role: Exclude<Role, "Customer">;
      active?: boolean;
      password?: string;
      permissions?: Record<string, boolean>;
    }): Promise<boolean> {
      try {
        if (prototypeMode) {
          if (input.userId) await updatePrototypeStaff({ ...input, userId: input.userId });
          else await createPrototypeStaff({ ...input, password: input.password ?? "" });
          setStaffUsers(getPrototypeStaff());
        } else {
          const response = await fetch("/api/staff", {
            method: input.userId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input.userId ? input : { ...input, password: input.password }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Could not save staff account.");
          const refresh = await fetch("/api/staff", { cache: "no-store" });
          const refreshed = await refresh.json();
          if (!refresh.ok) throw new Error(refreshed.error ?? "Could not refresh staff list.");
          setStaffUsers(refreshed.users as PrototypeStaff[]);
        }
        setStaffError("");
        setToast(input.userId ? "Staff account updated." : "Staff account created.");
        return true;
      } catch (saveError) {
        setStaffError(saveError instanceof Error ? saveError.message : "Could not save staff account.");
        return false;
      }
    }

    return <div className="stacked-panels">
      <section className="panel">
        <div className="eyebrow">Staff administration</div><h3>Create staff account</h3>
        <form className="filter-panel" onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const saved = await saveStaff({
            name: String(form.get("name") ?? ""),
            email: String(form.get("email") ?? ""),
            phone: String(form.get("phone") ?? ""),
            role: String(form.get("role") ?? "Receptionist") as Exclude<Role, "Customer">,
            password: String(form.get("password") ?? ""),
          });
          if (saved) formElement.reset();
        }}>
          <label>Full name<input name="name" required minLength={2} maxLength={100} /></label>
          <label>Email<input name="email" type="email" required maxLength={254} /></label>
          <label>Phone<input name="phone" required minLength={6} maxLength={30} /></label>
          <label>Role<select name="role" defaultValue={newStaffRole}><option>Receptionist</option><option>Warehouseman</option><option>Manager</option></select></label>
          <label>Temporary password<input name="password" type="password" required minLength={12} maxLength={128} /></label>
          <button className="button button-primary">Create staff account</button>
        </form>
      </section>
      {staffError && <div className="error-banner" role="alert">{staffError}<button onClick={() => setStaffError("")}>Dismiss</button></div>}
      <section className="panel"><div className="eyebrow">Four fixed roles</div><h3>Staff accounts & permissions</h3>
        {staffUsers.length ? <div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>ROLE</th><th>STATUS</th><th>CREATED</th><th>EDIT / PERMISSIONS</th></tr></thead><tbody>{staffUsers.map((staff) => <tr key={staff.id}><td><strong>{staff.name}</strong><small className="table-subtitle">{staff.email} · {staff.phone}</small></td><td>{staff.role}</td><td><StatusBadge label={staff.active ? "Active" : "Inactive"} tone={staff.active ? "success" : "danger"} /></td><td>{dateLabel(String(staff.createdAt))}</td><td><details><summary>Edit</summary>
          <form className="settings-form" onSubmit={(event) => {
            event.preventDefault(); const form = new FormData(event.currentTarget);
            void saveStaff({ userId: staff.id, name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), phone: String(form.get("phone") ?? ""), role: String(form.get("role") ?? staff.role) as Exclude<Role, "Customer">, password: String(form.get("password") ?? "") || undefined });
          }}>
            <label>Name<input name="name" required defaultValue={staff.name} /></label><label>Email<input name="email" type="email" required defaultValue={staff.email} /></label><label>Phone<input name="phone" required defaultValue={staff.phone} /></label><label>Role<select name="role" defaultValue={staff.role}><option>Manager</option><option>Receptionist</option><option>Warehouseman</option></select></label><label>New password (optional)<input name="password" type="password" minLength={12} /></label><button className="button button-secondary">Save staff details</button>
          </form>
          <button className={`button ${staff.active ? "button-secondary" : "button-primary"}`} onClick={() => void saveStaff({ userId: staff.id, name: staff.name, email: staff.email, phone: staff.phone, role: staff.role, active: !staff.active })}>{staff.active ? "Deactivate account" : "Activate account"}</button>
          <fieldset className="permission-list"><legend>Individual permissions (unchecked modules are denied)</legend>{permissionModules.map(([key, label]) => <label key={key}><input type="checkbox" checked={staff.permissions?.[key] !== false} onChange={(event) => void saveStaff({ userId: staff.id, name: staff.name, email: staff.email, phone: staff.phone, role: staff.role, permissions: { ...(staff.permissions ?? {}), [key]: event.target.checked } })} /> {label}</label>)}</fieldset>
        </details></td></tr>)}</tbody></table></div> : <EmptyState text="No staff accounts have been created." />}
      </section>
    </div>;
  }

  function renderPage() {
    switch (page) {
      case "Overview":
        return renderOverview();
      case "Catalog":
        return renderCatalog();
      case "Circulation":
        return renderCirculation();
      case "Reservations":
        return renderReservations();
      case "Inventory":
        return renderInventory();
      case "Customers":
        return renderCustomers();
      case "Settings":
        return renderSettings();
      case "Sales":
        return renderSales();
      case "Suppliers":
        return renderSuppliers();
      case "Reports":
        return renderReports();
      case "Audit":
        return renderAudit();
      case "Profile":
        return renderProfile();
      case "Staff":
        return renderStaff();
    }
  }

  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            goTo("Overview");
          }}
        >
          <span className="brand-mark">
            S<span>&</span>S
          </span>
          <span className="brand-name">
            shelf <i>&</i> soul<small>LIBRARY & BOOKSHOP</small>
          </span>
        </a>
        <div className="branch-chip">
          <span className="branch-dot" /> RAMALLAH BRANCH
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {visiblePages.map((item) => (
            <button
              key={item.page}
              className={`nav-item ${page === item.page ? "active" : ""}`}
              onClick={() => goTo(item.page)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.page}</span>
              {item.page === "Circulation" &&
                pendingRequests.length > 0 &&
                role !== "Customer" && (
                  <span className="nav-badge">{pendingRequests.length}</span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-help">
          <div className="help-icon">?</div>
          <strong>Need a hand?</strong>
          <span>We’re here to help you.</span>
          <button
            onClick={() =>
              setToast(
                "Visitor Help & FAQ is available from the sign-in page.",
              )
            }
          >
            Visit help center <span>→</span>
          </button>
        </div>
        <div className="sidebar-footer">
          Shelf & Soul <span>·</span> Prototype v1.0
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu-button"
            aria-label="Open navigation"
            onClick={() => setMobileMenuOpen(true)}
          >
            ☰
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-actions">
            <label className="global-search">
              <span aria-hidden="true">⌕</span>
              <input
                placeholder="Search anything…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (page !== "Catalog") goTo("Catalog");
                }}
                aria-label="Search catalog"
              />
              <kbd>⌘ K</kbd>
            </label>
            <div className="notice-wrap">
              <button
                className="icon-button notification-button"
                aria-label={`Notifications, ${unreadNotices} unread`}
                onClick={() => setNoticeOpen(!noticeOpen)}
              >
                ♧{unreadNotices > 0 && <span className="notification-dot" />}
              </button>
              {noticeOpen && (
                <div className="notification-popover">
                  <div className="popover-heading">
                    <div>
                      <strong>Notifications</strong>
                      <span>{unreadNotices} unread</span>
                    </div>
                    <button
                      onClick={() =>
                        perform(
                          { type: "markAllRead" },
                          "All notifications marked as read.",
                        )
                      }
                    >
                      Mark all read
                    </button>
                  </div>
                  {recentVisibleNotices.slice(0, 5).map((notice) => (
                    <button
                      className={`popover-notice ${notice.read ? "is-read" : ""}`}
                      key={notice.id}
                      onClick={() =>
                        perform(
                          { type: "markNoticeRead", noticeId: notice.id },
                          "Notification marked as read.",
                        )
                      }
                    >
                      <span className="alert-dot" />
                      <span>
                        {notice.message}
                        <small>{shortDate(notice.createdAt)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="user-menu">
              <span className="avatar user-avatar">
                {authUser.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <div>
                <strong>{authUser.name}</strong>
                <span>{role}</span>
              </div>
              <button
                className="sign-out-button"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{roleDescriptions[role]}</div>
              <h1>{pageTitle}</h1>
            </div>
          {page === "Overview" && prototypeMode && (
              <span className="prototype-pill">
                <span /> Prototype workspace
              </span>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>!</span>
              <p>{error}</p>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {renderPage()}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      )}
      {sessionWarning && (
        <div className="modal-backdrop" role="presentation">
          <section className="panel session-warning" role="alertdialog" aria-modal="true" aria-labelledby="session-warning-title">
            <div className="eyebrow">Session security</div>
            <h2 id="session-warning-title">You’ll be signed out in one minute</h2>
            <p>Continue using Shelf &amp; Soul to keep your session active.</p>
            <button className="button button-primary" onClick={() => setSessionWarning(false)}>Continue session</button>
          </section>
        </div>
      )}
    </div>
  );
}

function AuthPage({
  initialError,
  onAuthenticated,
  prototypeMode,
}: {
  initialError: string;
  onAuthenticated: (user: AuthenticatedUser) => void;
  prototypeMode: boolean;
}) {
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">("login");
  const [publicSection, setPublicSection] = useState<"none" | "catalog" | "about" | "contact" | "help">("none");
  const [publicBooks, setPublicBooks] = useState<(Pick<Book, "id" | "title" | "author" | "category" | "description" | "price" | "cover" | "forSale" | "quantity"> & { availability: string })[]>([]);
  const [publicContact, setPublicContact] = useState<{ branchAddress: string; contactEmail: string; contactPhone: string; openingHours: string }>({ branchAddress: "", contactEmail: "", contactPhone: "", openingHours: "" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [resetToken, setResetToken] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("reset");
    if (token) {
      setResetToken(token);
      setMode("reset");
    }
  }, []);

  const passwordRules = [
    { label: "At least 12 characters", valid: password.length >= 12 },
    { label: "One uppercase letter", valid: /[A-Z]/.test(password) },
    { label: "One lowercase letter", valid: /[a-z]/.test(password) },
    { label: "One number", valid: /[0-9]/.test(password) },
  ];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "forgot") {
        if (prototypeMode) {
          const token = await requestPrototypePasswordReset(email);
          if (token) setResetToken(token);
          setNotice(token
            ? `Local-only reset code (not emailed): ${token}`
            : "If an account exists for that email, password reset instructions will be sent.");
        } else {
          const response = await fetch("/api/auth/password-reset/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Could not request a password reset.");
          setNotice(result.message);
        }
        setMode(prototypeMode ? "reset" : "login");
        return;
      }
      if (mode === "reset") {
        if (prototypeMode) {
          await completePrototypePasswordReset(resetToken, password, confirmPassword);
        } else {
          const response = await fetch("/api/auth/password-reset/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: resetToken, password, confirmPassword }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Could not reset your password.");
          window.history.replaceState({}, "", window.location.pathname);
          setNotice(result.message);
        }
        if (prototypeMode) setNotice("Password updated. You can now sign in.");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setResetToken("");
        return;
      }
      if (prototypeMode) {
        const user =
          mode === "login"
            ? await loginPrototype(email, password)
            : await registerPrototype({
                name,
                email,
                phone,
                password,
                confirmPassword,
              });
        onAuthenticated(user);
        return;
      }

      const endpoint =
        mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        mode === "login"
          ? { email, password }
          : { name, email, phone, password, confirmPassword };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Could not complete your request.");
      }
      onAuthenticated(result.user as AuthenticatedUser);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not connect to the library. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function changeMode(nextMode: "login" | "register" | "forgot" | "reset") {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
  }

  async function openPublicSection(section: "catalog" | "about" | "contact" | "help") {
    setPublicSection(section);
    if (section !== "catalog" && section !== "contact") return;
    try {
      if (prototypeMode) {
        const state = await getPrototypeLibrary();
        setPublicContact({
          branchAddress: state.settings?.branchAddress ?? "",
          contactEmail: state.settings?.contactEmail ?? "",
          contactPhone: state.settings?.contactPhone ?? "",
          openingHours: state.settings?.openingHours ?? "",
        });
        if (section !== "catalog") return;
        setPublicBooks(state.books.filter((book) => !book.deletedAt).map((book) => {
          const held = state.reservations.filter((reservation) =>
            reservation.bookId === book.id &&
            reservation.status === "Ready for pickup" &&
            (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
          ).length;
          const quantity = Math.max(0, book.quantity
            - state.loans.filter((loan) => loan.bookId === book.id && loan.status === "Active").length
            - (book.damagedQuantity ?? 0)
            - held);
          return {
            ...book,
            quantity,
            availability: quantity > 0 ? "Available" : held > 0 ? "Reserved" : "Out of stock",
          };
        }));
        return;
      }
      const response = await fetch("/api/public/catalog", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load the public catalog.");
      setPublicContact(result.contactDetails ?? { branchAddress: "", contactEmail: "", contactPhone: "", openingHours: "" });
      if (section === "catalog") setPublicBooks(result.books);
    } catch (catalogError) {
      setError(catalogError instanceof Error ? catalogError.message : "Could not load the public catalog.");
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-layout">
        <section className="auth-welcome">
          <a className="brand auth-brand" href="/" aria-label="Shelf and Soul home">
            <span className="brand-mark">
              S<span>&</span>S
            </span>
            <span className="brand-name">
              shelf <i>&</i> soul
              <small>LIBRARY &amp; BOOKSHOP</small>
            </span>
          </a>
          <div className="auth-welcome-copy">
            <div className="eyebrow">A little room for wonder</div>
            <h1>
              Find your
              <br />
              next chapter.
            </h1>
            <p>
              A thoughtful library and bookshop, made for the stories that
              stay with you.
            </p>
            <div className="auth-quote">
              <span>“</span>
              <p>
                A book is a dream that you hold in your hand.
                <small>— Neil Gaiman</small>
              </p>
            </div>
          </div>
          <div className="auth-location">
            <span className="branch-dot" /> RAMALLAH, PALESTINE
          </div>
        </section>

        <section className="auth-form-wrap">
          <div className="auth-card">
            <div className="auth-form-heading">
              <div className="eyebrow">
                {mode === "login" ? "Welcome back" : mode === "register" ? "Your story starts here" : mode === "forgot" ? "Account recovery" : "Choose a new password"}
              </div>
              <h2>{mode === "login" ? "Sign in to Shelf & Soul" : mode === "register" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Set a new password"}</h2>
              <p>
                {mode === "login"
                  ? "Enter your account details to continue."
                  : mode === "register"
                    ? "Join the library and discover your next favorite."
                    : mode === "forgot"
                      ? "Enter your email and we’ll send reset instructions if an account matches."
                      : "Choose a strong password to secure your account."}
              </p>
            </div>
            <nav className="public-links" aria-label="Visitor pages">
              <button type="button" onClick={() => void openPublicSection("catalog")}>Browse catalog</button>
              <button type="button" onClick={() => void openPublicSection("about")}>About us</button>
              <button type="button" onClick={() => void openPublicSection("contact")}>Contact</button>
              <button type="button" onClick={() => void openPublicSection("help")}>Help &amp; FAQ</button>
            </nav>
            {publicSection !== "none" && <section className="public-content" aria-live="polite">
              <button className="back-link" onClick={() => setPublicSection("none")}>← Close visitor page</button>
              {publicSection === "catalog" && <><h3>Browse the collection</h3>{publicBooks.length ? <div className="table-wrap"><table><thead><tr><th>BOOK</th><th>AUTHOR</th><th>CATEGORY</th><th>PRICE</th><th>AVAILABILITY</th></tr></thead><tbody>{publicBooks.map((book) => <tr key={book.id}><td>{book.title}</td><td>{book.author}</td><td>{book.category}</td><td>{money(book.price)}</td><td>{book.availability}</td></tr>)}</tbody></table></div> : <EmptyState text="No books are available in the public catalog yet." />}</>}
              {publicSection === "about" && <><h3>About Shelf &amp; Soul</h3><p>A welcoming library and bookshop in Ramallah, bringing readers and stories together. Browse the catalog, reserve library books, and discover titles for your next chapter.</p></>}
              {publicSection === "contact" && <><h3>Contact the library</h3>{publicContact.branchAddress && <p><strong>Address:</strong> {publicContact.branchAddress}</p>}{publicContact.contactEmail && <p><strong>Email:</strong> <a href={`mailto:${publicContact.contactEmail}`}>{publicContact.contactEmail}</a></p>}{publicContact.contactPhone && <p><strong>Phone:</strong> <a href={`tel:${publicContact.contactPhone}`}>{publicContact.contactPhone}</a></p>}{publicContact.openingHours && <p><strong>Opening hours:</strong> {publicContact.openingHours}</p>}{!publicContact.branchAddress && !publicContact.contactEmail && !publicContact.contactPhone && !publicContact.openingHours && <p>Contact information has not been configured yet. A manager can add the branch details in System Settings.</p>}</>}
              {publicSection === "help" && <><h3>Help &amp; frequently asked questions</h3><details><summary>How do I borrow a book?</summary><p>Create an account, request an available book, and wait for library staff to approve the loan.</p></details><details><summary>How do reservations work?</summary><p>Reservations are queued in request order. When the book is ready, you have three days to collect it.</p></details><details><summary>How do I join?</summary><p>Register an account. Library staff approve membership activation.</p></details><details><summary>How are overdue fines calculated?</summary><p>The library currently charges ₪ 1 per overdue day, up to the book price.</p></details></>}
            </section>}
            {prototypeMode && (mode === "login" || mode === "forgot" || mode === "reset") && (
              <div className="prototype-login-note">
                <strong>Local prototype demo</strong>
                <span>
                  {mode === "reset"
                    ? "Password reset codes are generated locally and are not emailed. This mode is not secure for production."
                    : "Demo roles use ShelfSoulDemo2026!. Data stays in this browser only. This mode is not secure for production."}
                </span>
              </div>
            )}

            {(mode === "login" || mode === "register") && <div className="auth-tabs" role="tablist" aria-label="Account access">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "selected" : ""}
                onClick={() => changeMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "selected" : ""}
                onClick={() => changeMode("register")}
              >
                Create account
              </button>
            </div>}

            <form className="auth-form" onSubmit={(event) => void submit(event)}>
              {mode === "register" && (
                <>
                  <label>
                    Full name
                    <input
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      minLength={2}
                      maxLength={100}
                      required
                      placeholder="Your full name"
                    />
                  </label>
                  <label>
                    Phone number
                    <input
                      autoComplete="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      minLength={6}
                      maxLength={30}
                      required
                      placeholder="+970"
                    />
                  </label>
                </>
              )}
              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  maxLength={254}
                  required={mode !== "reset"}
                  placeholder="you@example.com"
                  disabled={mode === "reset"}
                />
              </label>
              {mode === "reset" && prototypeMode && (
                <label>
                  Local reset code
                  <input value={resetToken} onChange={(event) => setResetToken(event.target.value)} required autoComplete="one-time-code" />
                </label>
              )}
              {(mode === "login" || mode === "register" || mode === "reset") && <>
              <label>
                Password
                <span className="auth-password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    maxLength={128}
                    required
                    placeholder={
                      mode === "login" ? "Enter your password" : mode === "reset" ? "Create a new password" : "Create a password"
                    }
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </span>
              </label>

              {(mode === "register" || mode === "reset") && (
                <>
                  <ul className="password-rules" aria-label="Password requirements">
                    {passwordRules.map((rule) => (
                      <li
                        key={rule.label}
                        className={rule.valid ? "rule-valid" : ""}
                      >
                        <span>{rule.valid ? "✓" : "○"}</span>
                        {rule.label}
                      </li>
                    ))}
                  </ul>
                  <label>
                    Confirm password
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      maxLength={128}
                      required
                      aria-invalid={
                        confirmPassword.length > 0 &&
                        password !== confirmPassword
                      }
                      placeholder="Enter your password again"
                    />
                    {confirmPassword.length > 0 &&
                      password !== confirmPassword && (
                        <span className="field-error">
                          Passwords do not match.
                        </span>
                      )}
                  </label>
                </>
              )}
              </>}

              {mode === "login" && <button type="button" className="back-link" onClick={() => changeMode("forgot")}>Forgot password?</button>}
              {(mode === "forgot" || mode === "reset") && <button type="button" className="back-link" onClick={() => changeMode("login")}>Back to sign in</button>}

              {notice && <div className="prototype-login-note" role="status">{notice}</div>}
              {error && (
                <div className="auth-error" role="alert">
                  <span>!</span>
                  {error}
                </div>
              )}
              <button
                className="button button-primary auth-submit"
                type="submit"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="button-spinner" /> Please wait…
                  </>
                ) : mode === "login" ? (
                  "Sign in"
                ) : mode === "register" ? (
                  "Create account"
                ) : mode === "forgot" ? (
                  "Send reset instructions"
                ) : (
                  "Update password"
                )}
                {!submitting && <span aria-hidden="true">→</span>}
              </button>
            </form>

            <div className="auth-footnote">
              <span aria-hidden="true">♧</span>
              Passwords are stored as salted hashes.
            </div>
          </div>
          <p className="auth-copyright">
            Shelf &amp; Soul <span>·</span> A library for every kind of reader
          </p>
        </section>
      </div>
    </main>
  );
}

function BookCover({
  book,
  compact = false,
}: {
  book: Book;
  compact?: boolean;
}) {
  return (
    <div className={`book-cover ${compact ? "cover-compact" : ""}`}>
      <span className="cover-fallback">
        {book.title
          .split(" ")
          .slice(0, 2)
          .map((word) => word[0])
          .join("")}
      </span>
      <img
        src={book.cover}
        alt={`Cover of ${book.title}`}
        loading="lazy"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}

function BookCard({
  book,
  availability,
  onDetails,
  onReserve,
  onBorrow,
  role,
}: {
  book: Book;
  availability: { label: string; count: number };
  onDetails: () => void;
  onReserve: () => void;
  onBorrow: () => void;
  role: Role;
}) {
  return (
    <article className="book-card">
      <button
        className="cover-button"
        aria-label={`View details for ${book.title}`}
        onClick={onDetails}
      >
        <BookCover book={book} />
      </button>
      <div className="book-card-copy">
        <div className="book-category">{book.category}</div>
        <h3>{book.title}</h3>
        <p>{book.author}</p>
        <div className="card-meta">
          <span className="stars">★★★★★</span>
          <span>4.8</span>
          <StatusBadge
            label={availability.label}
            tone={availability.count > 0 ? "success" : "warning"}
          />
        </div>
        <div className="card-actions">
          <button
            className="button button-small button-secondary"
            onClick={onDetails}
          >
            Details
          </button>
          {role === "Customer" || role === "Receptionist" ? (
            <button
              className="button button-small button-primary"
              onClick={onReserve}
            >
              Reserve
            </button>
          ) : (
            <button
              className="button button-small button-secondary"
              onClick={onDetails}
            >
              View book
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}) {
  return (
    <span className={`status-badge tone-${tone}`}>
      <span />
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span>◌</span>
      <p>{text}</p>
    </div>
  );
}

function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
