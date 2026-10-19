import type {
  Book,
  LibraryAction,
  LibraryState,
  LibrarySettings,
  PurchaseOrder,
  Loan,
  Reservation,
  Role,
  StockMovement,
  StockByLocation,
  StockLocation,
  Sale,
} from "@/lib/types";

const DAY_MS = 86_400_000;

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function calendarDayDifference(
  targetDate: Date,
  currentDate = new Date(),
): number {
  const targetDay = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
  ).getTime();
  const currentDay = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  ).getTime();
  return Math.round((targetDay - currentDay) / DAY_MS);
}

function requireRole(role: Role, allowed: Role[]): void {
  if (!allowed.includes(role))
    throw new Error(`This action is not available to the ${role} role.`);
}

function getBook(state: LibraryState, bookId: string): Book {
  const book = state.books.find(
    (item) => item.id === bookId && !item.deletedAt,
  );
  if (!book)
    throw new Error("This book is no longer available in the catalog.");
  return book;
}

function getMember(state: LibraryState, memberId: string) {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) throw new Error("Customer record not found.");
  return member;
}

function stockAtLocations(book: Book): StockByLocation {
  return book.stockByLocation ?? (book.location === "Warehouse"
    ? { Warehouse: book.quantity, "Library floor": 0 }
    : { Warehouse: 0, "Library floor": book.quantity });
}

function changeStockLocation(book: Book, delta: number, preferred: StockLocation): Book {
  const stock = { ...stockAtLocations(book) };
  if (delta >= 0) {
    stock[preferred] += delta;
  } else {
    let remaining = -delta;
    const fromPreferred = Math.min(stock[preferred], remaining);
    stock[preferred] -= fromPreferred;
    remaining -= fromPreferred;
    const other: StockLocation = preferred === "Warehouse" ? "Library floor" : "Warehouse";
    if (remaining > stock[other]) throw new Error("There is not enough stock across the locations.");
    stock[other] -= remaining;
  }
  return {
    ...book,
    quantity: stock.Warehouse + stock["Library floor"],
    stockByLocation: stock,
    location: stock.Warehouse > stock["Library floor"] ? "Warehouse" : "Library floor",
  };
}

function availableCopies(state: LibraryState, bookId: string): number {
  const book = getBook(state, bookId);
  const borrowed = state.loans.filter(
    (loan) => loan.bookId === bookId && loan.status === "Active",
  ).length;
  const held = state.reservations.filter(
    (reservation) =>
      reservation.bookId === bookId &&
      reservation.status === "Ready for pickup" &&
      (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
  ).length;
  return Math.max(0, book.quantity - borrowed - (book.damagedQuantity ?? 0) - held);
}

function createNotice(
  state: LibraryState,
  message: string,
  memberId?: string,
): LibraryState["notices"] {
  return [
    {
      id: newId("N"),
      message,
      createdAt: new Date().toISOString(),
      read: false,
      ...(memberId ? { memberId } : {}),
    },
    ...state.notices,
  ];
}

function createMovement(
  state: LibraryState,
  bookId: string,
  type: string,
  before: number,
  after: number,
  reason: string,
  employee: string,
): StockMovement[] {
  return [
    {
      id: newId("ST"),
      bookId,
      type,
      before,
      after,
      reason,
      employee,
      createdAt: new Date().toISOString(),
    },
    ...state.movements,
  ];
}

function advanceReservationQueue(
  state: LibraryState,
  bookId?: string,
): LibraryState {
  const bookIds = bookId
    ? [bookId]
    : [...new Set(state.reservations.map((reservation) => reservation.bookId))];
  let reservations = state.reservations;
  let notices = state.notices;
  const now = new Date();

  for (const id of bookIds) {
    const ready = reservations.find(
      (reservation) =>
        reservation.bookId === id &&
        reservation.status === "Ready for pickup" &&
        reservation.holdUntil &&
        Date.parse(reservation.holdUntil) <= now.getTime(),
    );
    if (ready) {
      reservations = reservations.map((reservation) =>
        reservation.id === ready.id
          ? { ...reservation, status: "Expired" }
          : reservation,
      );
      const nextMember = state.members.find(
        (member) => member.id === ready.memberId,
      );
      const book = state.books.find((item) => item.id === id);
      if (nextMember && book) {
        notices = createNotice(
          { ...state, notices },
          `The pickup hold for ${book.title} expired for ${nextMember.name}.`,
          nextMember.id,
        );
      }
    }

    const hasReady = reservations.some(
      (reservation) =>
        reservation.bookId === id && reservation.status === "Ready for pickup",
    );
    if (hasReady) continue;
    const queued = reservations
      .filter(
        (reservation) =>
          reservation.bookId === id && reservation.status === "Queued",
      )
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (!queued) continue;

    const activeLoans = state.loans.filter(
      (loan) => loan.bookId === id && loan.status === "Active",
    ).length;
    const book = state.books.find((item) => item.id === id);
    if (!book || book.quantity - activeLoans - (book.damagedQuantity ?? 0) < 1) continue;
    const holdUntil = new Date(
      now.getTime() + (state.settings?.reservationHoldDays ?? 3) * DAY_MS,
    ).toISOString();
    reservations = reservations.map((reservation) =>
      reservation.id === queued.id
        ? { ...reservation, status: "Ready for pickup", holdUntil }
        : reservation,
    );
    const member = state.members.find((item) => item.id === queued.memberId);
    if (member)
      notices = createNotice(
        { ...state, notices },
        `${book.title} is ready for pickup for ${member.name}.`,
        member.id,
      );
  }

  return reservations === state.reservations && notices === state.notices
    ? state
    : { ...state, reservations, notices };
}

function validateLoan(state: LibraryState, memberId: string): void {
  const member = getMember(state, memberId);
  if (
    member.membershipStatus !== "Active" ||
    Date.parse(member.membershipExpiresAt) < Date.now()
  ) {
    throw new Error("An active membership is required to borrow books.");
  }
  if (member.unpaidFines > 10)
    throw new Error(
      "Outstanding fines above ₪ 10 must be paid before borrowing.",
    );
  const activeLoans = state.loans.filter(
    (loan) => loan.memberId === memberId && loan.status === "Active",
  ).length;
  if (activeLoans >= (state.settings?.maxLoans ?? 3))
    throw new Error(`A customer may have at most ${state.settings?.maxLoans ?? 3} books on loan.`);
}

export function reserveBook(
  state: LibraryState,
  bookId: string,
  memberId: string,
  role: Role,
): LibraryState {
  requireRole(role, ["Customer", "Receptionist"]);
  state = advanceReservationQueue(state);
  const book = getBook(state, bookId);
  const member = getMember(state, memberId);
  if (
    member.membershipStatus !== "Active" ||
    Date.parse(member.membershipExpiresAt) < Date.now()
  ) {
    throw new Error("An active membership is required to reserve books.");
  }
  const activeReservations = state.reservations.filter(
    (reservation) =>
      reservation.memberId === memberId &&
      ["Queued", "Ready for pickup"].includes(reservation.status),
  );
  const maxReservations = state.settings?.maxReservations ?? 3;
  if (activeReservations.length >= maxReservations)
    throw new Error(`A customer may have at most ${maxReservations} active reservations.`);
  if (activeReservations.some((reservation) => reservation.bookId === bookId)) {
    throw new Error(
      "This customer already has an active reservation for this book.",
    );
  }
  const alreadyInQueue = state.reservations.some(
    (reservation) =>
      reservation.bookId === bookId &&
      ["Queued", "Ready for pickup"].includes(reservation.status),
  );
  const isImmediatelyAvailable =
    availableCopies(state, bookId) > 0 && !alreadyInQueue;
  const createdAt = new Date().toISOString();
  const reservation: Reservation = {
    id: newId("RS"),
    bookId: book.id,
    memberId,
    createdAt,
    status: isImmediatelyAvailable ? "Ready for pickup" : "Queued",
    ...(isImmediatelyAvailable
      ? { holdUntil: new Date(Date.now() + (state.settings?.reservationHoldDays ?? 3) * DAY_MS).toISOString() }
      : {}),
  };
  const next = {
    ...state,
    reservations: [...state.reservations, reservation],
    notices: createNotice(
      state,
      isImmediatelyAvailable
        ? `${book.title} is ready for pickup for ${member.name}.`
        : `${member.name} joined the reservation queue for ${book.title}.`,
      member.id,
    ),
  };
  return advanceReservationQueue(next, bookId);
}

export function requestBorrow(
  state: LibraryState,
  bookId: string,
  memberId: string,
  role: Role,
): LibraryState {
  requireRole(role, ["Customer"]);
  const book = getBook(state, bookId);
  validateLoan(state, memberId);
  if (availableCopies(state, bookId) < 1)
    throw new Error("There are no available copies to request.");
  const alreadyRequested = state.requests.some(
    (request) =>
      request.bookId === bookId &&
      request.memberId === memberId &&
      request.status === "Pending",
  );
  if (alreadyRequested)
    throw new Error("A borrow request for this book is already pending.");
  return {
    ...state,
    requests: [
      {
        id: newId("BR"),
        bookId,
        memberId,
        requestedAt: new Date().toISOString(),
        status: "Pending",
      },
      ...state.requests,
    ],
    notices: createNotice(
      state,
      `Borrow request submitted for ${book.title}.`,
      memberId,
    ),
  };
}

export function approveBorrowRequest(
  state: LibraryState,
  requestId: string,
  role: Role,
): LibraryState {
  requireRole(role, ["Receptionist"]);
  const request = state.requests.find(
    (item) => item.id === requestId && item.status === "Pending",
  );
  if (!request) throw new Error("This borrow request is no longer pending.");
  const book = getBook(state, request.bookId);
  validateLoan(state, request.memberId);
  if (availableCopies(state, book.id) < 1)
    throw new Error("This book no longer has an available copy.");
  const issueDate = new Date();
  const loan: Loan = {
    id: newId("LN"),
    bookId: book.id,
    memberId: request.memberId,
    issuedAt: issueDate.toISOString(),
    dueAt: new Date(issueDate.getTime() + (state.settings?.loanDays ?? 14) * DAY_MS).toISOString(),
    renewals: 0,
    status: "Active",
  };
  const availableBefore = availableCopies(state, book.id);
  const next = {
    ...state,
    requests: state.requests.map((item) =>
      item.id === requestId ? { ...item, status: "Approved" as const } : item,
    ),
    loans: [loan, ...state.loans],
    movements: createMovement(
      state,
      book.id,
      "Book issued",
      availableBefore,
      availableBefore - 1,
      `Loan ${loan.id}`,
      role,
    ),
  };
  next.notices = createNotice(
    next,
    `Borrow request approved for ${book.title}.`,
    request.memberId,
  );
  return next;
}

export function rejectBorrowRequest(
  state: LibraryState,
  requestId: string,
  role: Role,
): LibraryState {
  requireRole(role, ["Receptionist"]);
  const request = state.requests.find(
    (item) => item.id === requestId && item.status === "Pending",
  );
  if (!request) throw new Error("This borrow request is no longer pending.");
  const book = getBook(state, request.bookId);
  const next = {
    ...state,
    requests: state.requests.map((item) =>
      item.id === requestId ? { ...item, status: "Rejected" as const } : item,
    ),
  };
  next.notices = createNotice(
    next,
    `Borrow request for ${book.title} was declined.`,
    request.memberId,
  );
  return next;
}

export function returnLoan(
  state: LibraryState,
  loanId: string,
  role: Role,
  condition: Book["condition"] = "Good",
): LibraryState {
  requireRole(role, ["Receptionist"]);
  const loan = state.loans.find(
    (item) => item.id === loanId && item.status === "Active",
  );
  if (!loan) throw new Error("This loan is not active.");
  const book = getBook(state, loan.bookId);
  const member = getMember(state, loan.memberId);
  const now = new Date();
  const overdueDays = Math.max(
    0,
    -calendarDayDifference(new Date(loan.dueAt), now),
  );
  const fine = Math.min(
    overdueDays * (state.settings?.finePerDay ?? 1),
    state.settings?.fineCapAtBookPrice === false ? Number.POSITIVE_INFINITY : book.price,
  );
  const before = availableCopies(state, book.id);
  let next: LibraryState = {
    ...state,
    loans: state.loans.map((item) =>
      item.id === loanId
        ? {
            ...item,
            status: "Returned" as const,
            returnedAt: now.toISOString(),
          }
        : item,
    ),
    members: state.members.map((item) =>
      item.id === member.id
        ? { ...item, unpaidFines: item.unpaidFines + fine }
        : item,
    ),
    books: state.books.map((item) =>
        item.id === book.id && condition === "Damaged"
          ? {
              ...item,
              condition: "Damaged",
              damagedQuantity: (item.damagedQuantity ?? 0) + 1,
            }
          : item,
    ),
    movements: createMovement(
        state,
        book.id,
        condition === "Damaged" ? "Damaged return" : "Book returned",
        before,
        before + (condition === "Damaged" ? 0 : 1),
        `Return ${loan.id} · condition ${condition}`,
        role,
    ),
  };
  if (fine > 0)
    next.notices = createNotice(
      next,
      `${member.name} has an overdue fine of ₪ ${fine.toFixed(2)}.`,
      member.id,
    );

  return advanceReservationQueue(next, book.id);
}

export function toggleNoticeRead(
  state: LibraryState,
  noticeId: string,
): LibraryState {
  return {
    ...state,
    notices: state.notices.map((notice) =>
      notice.id === noticeId ? { ...notice, read: true } : notice,
    ),
  };
}

export function approveMembership(
  state: LibraryState,
  memberId: string,
  role: Role,
): LibraryState {
  requireRole(role, ["Manager", "Receptionist"]);
  const member = getMember(state, memberId);
  if (member.membershipStatus !== "Pending") {
    throw new Error("This membership is not awaiting approval.");
  }
  return {
    ...state,
    members: state.members.map((item) =>
      item.id === memberId
        ? { ...item, membershipStatus: "Active" as const }
        : item,
    ),
    notices: createNotice(
      state,
      "Your library membership has been approved.",
      memberId,
    ),
  };
}

function audit(
  state: LibraryState,
  actor: string,
  action: string,
  item: string,
  before?: string,
  after?: string,
): LibraryState {
  return {
    ...state,
    auditLog: [
      {
        id: newId("AUD"),
        actor,
        action,
        item,
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
        createdAt: new Date().toISOString(),
      },
      ...(state.auditLog ?? []),
    ],
  };
}

function requireReason(reason: string): string {
  const value = reason.trim();
  if (value.length < 3 || value.length > 500) {
    throw new Error("Enter a reason between 3 and 500 characters.");
  }
  return value;
}

export function executeLibraryAction(
  initialState: LibraryState,
  action: LibraryAction,
  role: Role,
  memberId: string | null,
  actorName: string = role,
): LibraryState {
  let state = initialState;
  let next: LibraryState;
  const actor = actorName || role;

  switch (action.type) {
    case "reserve":
      if (!memberId && role === "Customer") throw new Error("Your account has no membership profile.");
      next = reserveBook(state, action.bookId, role === "Customer" ? memberId! : action.memberId ?? "", role);
      break;
    case "requestBorrow":
      if (!memberId) throw new Error("Your account has no membership profile.");
      next = requestBorrow(state, action.bookId, memberId, role);
      break;
    case "approveRequest":
      next = approveBorrowRequest(state, action.requestId, role);
      break;
    case "rejectRequest":
      next = rejectBorrowRequest(state, action.requestId, role);
      break;
    case "returnLoan":
      next = returnLoan(state, action.loanId, role, action.condition);
      break;
    case "checkoutLoan": {
      requireRole(role, ["Receptionist"]);
      const book = getBook(state, action.bookId);
      validateLoan(state, action.memberId);
      const before = availableCopies(state, book.id);
      if (before < 1) throw new Error("There are no available copies to issue.");
      const now = new Date();
      const loan: Loan = {
        id: newId("LN"),
        bookId: book.id,
        memberId: action.memberId,
        issuedAt: now.toISOString(),
        dueAt: new Date(now.getTime() + (state.settings?.loanDays ?? 14) * DAY_MS).toISOString(),
        renewals: 0,
        status: "Active",
      };
      next = {
        ...state,
        loans: [loan, ...state.loans],
        movements: createMovement(state, book.id, "Book issued", before, before - 1, `Loan ${loan.id}`, actor),
      };
      return audit(next, actor, "Issued book", loan.id, String(before), String(before - 1));
    }
      break;
    case "markNoticeRead":
      if (role === "Customer" && !state.notices.some((notice) => notice.id === action.noticeId && notice.memberId === memberId)) {
        throw new Error("Notification not found.");
      }
      next = toggleNoticeRead(state, action.noticeId);
      break;
    case "markAllRead":
      next = {
        ...state,
        notices: state.notices.map((notice) =>
          role === "Customer" && notice.memberId !== memberId ? notice : { ...notice, read: true },
        ),
      };
      break;
    case "approveMembership":
      next = approveMembership(state, action.memberId, role);
      break;
    case "saveMember": {
      requireRole(role, ["Manager", "Receptionist"]);
      const input = action.member;
      const name = input.name.trim();
      const email = input.email.trim().toLowerCase();
      const phone = input.phone.trim();
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 6) {
        throw new Error("Enter a valid member name, email, and phone number.");
      }
      if (state.members.some((item) => item.email === email && item.id !== input.id)) {
        throw new Error("Another member already uses this email address.");
      }
      const existing = input.id ? getMember(state, input.id) : undefined;
      const member = {
        id: existing?.id ?? newId("MB"),
        name,
        email,
        phone,
        membershipStatus: input.membershipStatus,
        membershipExpiresAt: input.membershipExpiresAt,
        unpaidFines: existing?.unpaidFines ?? 0,
      };
      next = {
        ...state,
        members: existing
          ? state.members.map((item) => item.id === existing.id ? member : item)
          : [member, ...state.members],
      };
      return audit(next, actor, existing ? "Edited member" : "Registered member", member.id, existing ? JSON.stringify(existing) : undefined, JSON.stringify(member));
    }
    case "cancelReservation": {
      const reservation = state.reservations.find((item) => item.id === action.reservationId);
      if (!reservation || !["Queued", "Ready for pickup"].includes(reservation.status)) {
        throw new Error("This reservation can no longer be cancelled.");
      }
      if (role === "Customer" && reservation.memberId !== memberId) throw new Error("You can only cancel your own reservation.");
      requireRole(role, ["Customer", "Receptionist"]);
      next = advanceReservationQueue({
        ...state,
        reservations: state.reservations.map((item) =>
          item.id === reservation.id ? { ...item, status: "Cancelled" as const } : item,
        ),
      }, reservation.bookId);
      break;
    }
    case "requestRenewal": {
      requireRole(role, ["Customer"]);
      const loan = state.loans.find((item) => item.id === action.loanId && item.status === "Active");
      if (!loan || loan.memberId !== memberId) throw new Error("Active loan not found.");
      if (loan.renewals >= 1 || Date.parse(loan.dueAt) < Date.now()) throw new Error("This loan is not eligible for renewal.");
      if (state.reservations.some((item) => item.bookId === loan.bookId && ["Queued", "Ready for pickup"].includes(item.status))) {
        throw new Error("This book has a reservation and cannot be renewed.");
      }
      if ((state.renewals ?? []).some((item) => item.loanId === loan.id && item.status === "Pending")) {
        throw new Error("A renewal request is already pending.");
      }
      next = {
        ...state,
        renewals: [{ id: newId("RN"), loanId: loan.id, requestedAt: new Date().toISOString(), status: "Pending" }, ...(state.renewals ?? [])],
      };
      break;
    }
    case "decideRenewal": {
      requireRole(role, ["Receptionist"]);
      const request = (state.renewals ?? []).find((item) => item.id === action.requestId && item.status === "Pending");
      if (!request) throw new Error("This renewal request is no longer pending.");
      const loan = state.loans.find((item) => item.id === request.loanId && item.status === "Active");
      if (!loan) throw new Error("The loan is no longer active.");
      if (action.approve) {
        if (loan.renewals >= 1 || Date.parse(loan.dueAt) < Date.now() || state.reservations.some((item) => item.bookId === loan.bookId && ["Queued", "Ready for pickup"].includes(item.status))) {
          throw new Error("The loan no longer meets the renewal rules.");
        }
      }
      next = {
        ...state,
        renewals: (state.renewals ?? []).map((item) => item.id === request.id ? { ...item, status: action.approve ? "Approved" : "Rejected" } : item),
        loans: action.approve
          ? state.loans.map((item) => item.id === loan.id ? { ...item, renewals: item.renewals + 1, dueAt: new Date(Date.parse(item.dueAt) + (state.settings?.loanDays ?? 14) * DAY_MS).toISOString() } : item)
          : state.loans,
      };
      break;
    }
    case "saveBook": {
      requireRole(role, ["Manager"]);
      const input = action.book;
      if (!input.title.trim() || !input.author.trim() || !input.category.trim() || !Number.isInteger(input.quantity) || input.quantity < 0 || input.price < 0) {
        throw new Error("Enter a title, author, category, non-negative whole quantity, and valid price.");
      }
      const duplicate = state.books.some((item) => item.isbn === input.isbn && item.id !== input.id && !item.deletedAt);
      if (duplicate) throw new Error("A book with this ISBN already exists.");
      const existing = state.books.find((item) => item.id === input.id);
      const bookId = input.id ?? newId("BK");
      if (existing) {
        const committed = state.loans.filter((loan) => loan.bookId === existing.id && loan.status === "Active").length + (existing.damagedQuantity ?? 0);
        if (input.quantity < committed) throw new Error("Total stock cannot be reduced below active loans and damaged copies.");
      }
      const stockBook: Book = existing
        ? changeStockLocation(existing, input.quantity - existing.quantity, existing.location ?? "Library floor")
        : {
            ...input,
          id: bookId,
          stockByLocation: input.location === "Warehouse"
              ? { Warehouse: input.quantity, "Library floor": 0 }
              : { Warehouse: 0, "Library floor": input.quantity },
          };
      const book: Book = { ...stockBook, ...input, location: stockBook.location, stockByLocation: stockBook.stockByLocation, id: bookId, title: input.title.trim(), author: input.author.trim(), category: input.category.trim(), cover: input.cover || "", isbn: input.isbn.trim() };
      next = { ...state, books: existing ? state.books.map((item) => item.id === book.id ? book : item) : [book, ...state.books], categories: [...new Set([...(state.categories ?? []), book.category]) ] };
      state = audit(next, actor, existing ? "Edited book" : "Added book", book.title, existing ? JSON.stringify(existing) : undefined, JSON.stringify(book));
      return state;
    }
    case "deleteBook":
    case "restoreBook": {
      requireRole(role, ["Manager"]);
      const book = state.books.find((item) => item.id === action.bookId);
      if (!book) throw new Error("Book not found.");
      if (action.type === "deleteBook" && state.loans.some((loan) => loan.bookId === book.id && loan.status === "Active")) {
        throw new Error("Return all active loans before deleting this book.");
      }
      const deletedAt = action.type === "deleteBook" ? new Date().toISOString() : undefined;
      next = { ...state, books: state.books.map((item) => item.id === book.id ? { ...item, deletedAt } : item) };
      state = audit(next, actor, action.type === "deleteBook" ? "Soft-deleted book" : "Restored book", book.title);
      return state;
    }
    case "adjustStock": {
      requireRole(role, ["Manager", "Receptionist", "Warehouseman"]);
      const book = getBook(state, action.bookId);
      const reason = requireReason(action.reason);
      const committed = state.loans.filter((loan) => loan.bookId === book.id && loan.status === "Active").length +
        (book.damagedQuantity ?? 0) +
        state.reservations.filter((reservation) =>
          reservation.bookId === book.id &&
          reservation.status === "Ready for pickup" &&
          (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
        ).length;
      if (!Number.isInteger(action.quantity) || book.quantity + action.quantity < committed) throw new Error("Stock adjustment cannot reduce total stock below active loans and damaged copies.");
      const before = book.quantity;
      const after = before + action.quantity;
      next = {
        ...state,
        books: state.books.map((item) => item.id === book.id ? changeStockLocation(item, action.quantity, item.location ?? "Library floor") : item),
        movements: createMovement(state, book.id, "Manual adjustment", before, after, reason, role),
      };
      return audit(next, actor, "Adjusted stock", book.title, String(before), `${after}: ${reason}`);
    }
    case "recordStockLoss": {
      requireRole(role, ["Manager", "Warehouseman"]);
      const book = getBook(state, action.bookId);
      const reason = requireReason(action.reason);
      if (!Number.isInteger(action.quantity) || action.quantity < 1 || action.quantity > book.quantity) {
        throw new Error("Enter a whole-number loss quantity within the current stock.");
      }
      const active = state.loans.filter((loan) => loan.bookId === book.id && loan.status === "Active").length;
      const held = state.reservations.filter((reservation) =>
        reservation.bookId === book.id &&
        reservation.status === "Ready for pickup" &&
        (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
      ).length;
      const availableUndamaged = book.quantity - active - (book.damagedQuantity ?? 0) - held;
      if (action.quantity > availableUndamaged) {
        throw new Error("The recorded quantity cannot include stock on loan or already damaged.");
      }
      const before = book.quantity;
      const after = action.lossType === "Lost" ? before - action.quantity : before;
      next = {
        ...state,
        books: state.books.map((item) => item.id === book.id
          ? action.lossType === "Lost"
            ? changeStockLocation(item, -action.quantity, item.location ?? "Library floor")
            : { ...item, damagedQuantity: (item.damagedQuantity ?? 0) + action.quantity }
          : item),
        movements: createMovement(state, book.id, action.lossType === "Damaged" ? "Damaged stock recorded" : "Stock loss recorded", before, after, reason, actor),
      };
      return audit(next, actor, action.lossType === "Damaged" ? "Recorded damaged stock" : "Recorded stock loss", book.title, String(before), `${after}: ${reason}`);
    }
    case "transferStock": {
      requireRole(role, ["Manager", "Warehouseman"]);
      const book = getBook(state, action.bookId);
      const reason = requireReason(action.reason);
      if (action.from === action.to || !Number.isInteger(action.quantity) || action.quantity < 1) {
        throw new Error("Choose two different locations and a positive whole-number quantity.");
      }
      const stock = stockAtLocations(book);
      if (action.quantity > stock[action.from]) throw new Error("The source location does not have enough copies.");
      const updatedStock = { ...stock, [action.from]: stock[action.from] - action.quantity, [action.to]: stock[action.to] + action.quantity };
      const updatedBook: Book = {
        ...book,
        stockByLocation: updatedStock,
        location: updatedStock.Warehouse > updatedStock["Library floor"] ? "Warehouse" : "Library floor",
      };
      next = {
        ...state,
        books: state.books.map((item) => item.id === book.id ? updatedBook : item),
        movements: createMovement(state, book.id, "Location transfer", stock[action.from], updatedStock[action.from], `${action.quantity} copies: ${action.from} to ${action.to}. ${reason}`, actor),
      };
      return audit(next, actor, "Transferred stock", book.title, `${action.quantity} from ${action.from}`, `${action.quantity} to ${action.to}: ${reason}`);
    }
    case "createSale": {
      const customerPickupOrder = role === "Customer" && action.paymentMethod === "Cash on pickup";
      if (customerPickupOrder) requireRole(role, ["Customer"]);
      else requireRole(role, ["Receptionist", "Manager"]);
      const saleMemberId = role === "Customer" ? memberId : action.customerId;
      if (!saleMemberId) throw new Error("Select a customer for this sale.");
      if (!action.items.length) throw new Error("Add at least one book to the sale.");
      if (customerPickupOrder && action.paymentMethod !== "Cash on pickup") throw new Error("Customer orders use cash on pickup.");
      if (!customerPickupOrder && action.paymentMethod !== "Cash") throw new Error("In-library sales accept cash only.");
      const items: Sale["items"] = [];
      let total = 0;
      for (const item of action.items) {
        const book = getBook(state, item.bookId);
        if (!book.forSale || book.price <= 0) throw new Error(`${book.title} is not available for sale.`);
        if (!Number.isInteger(item.quantity) || item.quantity < 1 || availableCopies(state, book.id) < item.quantity) throw new Error(`Not enough available stock for ${book.title}.`);
        items.push({ bookId: book.id, quantity: item.quantity, unitPrice: book.price });
        total += book.price * item.quantity;
        const before = book.quantity;
        const after = before - item.quantity;
        state = {
          ...state,
          books: state.books.map((itemBook) => itemBook.id === book.id ? changeStockLocation(itemBook, -item.quantity, "Library floor") : itemBook),
          movements: createMovement(state, book.id, "Book sale", before, after, "Sale", role),
        };
      }
      const sale: Sale = {
        id: newId("INV"),
        memberId: saleMemberId,
        items,
        total,
        paymentMethod: action.paymentMethod,
        status: customerPickupOrder ? "Pending" : "Ready",
        paymentStatus: customerPickupOrder ? "Unpaid" : "Paid",
        createdAt: new Date().toISOString(),
      };
      next = { ...state, sales: [sale, ...(state.sales ?? [])] };
      next = audit(next, actor, "Recorded sale", sale.id, undefined, moneyValue(total));
      return next;
    }
    case "updateOrder": {
      const sale = (state.sales ?? []).find((item) => item.id === action.orderId);
      if (!sale) throw new Error("Order not found.");
      if (role === "Customer") {
        if (sale.memberId !== memberId || action.status !== "Cancelled" || sale.status !== "Pending") {
          throw new Error("You can only cancel your own cash-on-pickup order before staff mark it ready.");
        }
      } else {
        requireRole(role, ["Manager", "Receptionist"]);
        if (action.status === "Ready" && (sale.paymentMethod !== "Cash on pickup" || sale.status !== "Pending")) {
          throw new Error("Only a pending cash-on-pickup order can be marked ready.");
        }
        if (action.status === "Collected" && (sale.paymentMethod !== "Cash on pickup" || sale.status !== "Ready")) {
          throw new Error("Confirm cash only when a ready cash-on-pickup order is collected.");
        }
        if (action.status === "Cancelled" && (sale.paymentStatus === "Paid" || !["Pending", "Ready"].includes(sale.status))) {
          throw new Error("Only an unpaid pickup order can be cancelled.");
        }
      }
      next = {
        ...state,
        sales: (state.sales ?? []).map((item) => item.id === sale.id
          ? { ...item, status: action.status, ...(action.status === "Collected" ? { paymentStatus: "Paid" as const } : {}) }
          : item),
      };
      if (action.status === "Cancelled") {
        for (const item of sale.items) {
          const book = state.books.find((entry) => entry.id === item.bookId);
          if (!book) continue;
          const before = book.quantity;
          const after = before + item.quantity;
          next = {
            ...next,
            books: next.books.map((entry) => entry.id === book.id ? changeStockLocation(entry, item.quantity, "Library floor") : entry),
            movements: createMovement(next, book.id, "Order cancelled", before, after, `Refund order ${sale.id}`, role),
          };
        }
      }
      state = audit(next, actor, `Order ${action.status.toLowerCase()}`, sale.id);
      return state;
    }
    case "collectFinePayment": {
      requireRole(role, ["Manager", "Receptionist"]);
      const member = getMember(state, action.memberId);
      if (!Number.isFinite(action.amount) || action.amount <= 0 || action.amount > member.unpaidFines) {
        throw new Error("Enter a cash payment greater than zero and no more than the member's outstanding balance.");
      }
      next = {
        ...state,
        members: state.members.map((item) => item.id === member.id
          ? { ...item, unpaidFines: Math.max(0, Number((item.unpaidFines - action.amount).toFixed(2))) }
          : item),
      };
      return audit(next, actor, "Collected cash fine payment", member.name, moneyValue(member.unpaidFines), moneyValue(Math.max(0, member.unpaidFines - action.amount)));
    }
    case "adjustFine": {
      requireRole(role, ["Manager"]);
      const member = getMember(state, action.memberId);
      const reason = requireReason(action.reason);
      if (!Number.isFinite(action.amount) || member.unpaidFines + action.amount < 0) throw new Error("Fine adjustment cannot make the outstanding balance negative.");
      next = { ...state, members: state.members.map((item) => item.id === member.id ? { ...item, unpaidFines: item.unpaidFines + action.amount } : item) };
      state = audit(next, actor, "Adjusted fine", member.name, String(member.unpaidFines), `${member.unpaidFines + action.amount}: ${reason}`);
      return state;
    }
    case "saveSupplier": {
      requireRole(role, ["Manager"]);
      const supplier = action.supplier;
      if (!supplier.name.trim() || !supplier.phone.trim() || !supplier.address.trim()) throw new Error("Supplier name, phone, and address are required.");
      const saved = { ...supplier, id: supplier.id ?? newId("SUP") };
      next = { ...state, suppliers: (state.suppliers ?? []).some((item) => item.id === saved.id) ? (state.suppliers ?? []).map((item) => item.id === saved.id ? saved : item) : [saved, ...(state.suppliers ?? [])] };
      state = audit(next, actor, "Saved supplier", saved.name);
      return state;
    }
    case "createPurchaseOrder": {
      requireRole(role, ["Manager", "Warehouseman"]);
      const supplier = (state.suppliers ?? []).find((item) => item.id === action.supplierId);
      if (!supplier || !action.items.length) throw new Error("Select a supplier and at least one book.");
      for (const item of action.items) {
        getBook(state, item.bookId);
        if (!Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error("Purchase order quantities and prices must be valid.");
      }
      const order: PurchaseOrder = { id: newId("PO"), supplierId: supplier.id, items: action.items, total: action.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), status: "Suggested", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: role };
      next = { ...state, purchaseOrders: [order, ...(state.purchaseOrders ?? [])] };
      return audit(next, actor, "Suggested purchase order", order.id, undefined, order.status);
    }
    case "decidePurchaseOrder": {
      requireRole(role, ["Manager"]);
      const order = (state.purchaseOrders ?? []).find((item) => item.id === action.orderId);
      const validTransition = order && (
        (order.status === "Suggested" && ["Approved", "Cancelled"].includes(action.status)) ||
        (order.status === "Approved" && action.status === "Sent")
      );
      if (!order || !validTransition) throw new Error("Approve or cancel a suggested purchase order, then send it after approval.");
      next = { ...state, purchaseOrders: (state.purchaseOrders ?? []).map((item) => item.id === order.id ? { ...item, status: action.status, updatedAt: new Date().toISOString() } : item) };
      return audit(next, actor, `Purchase order ${action.status.toLowerCase()}`, order.id, order.status, action.status);
    }
    case "receivePurchaseOrder": {
      requireRole(role, ["Warehouseman"]);
      const order = (state.purchaseOrders ?? []).find((item) => item.id === action.orderId && item.status === "Sent");
      if (!order) throw new Error("Only a sent purchase order can be received.");
      next = state;
      for (const item of order.items) {
        const book = getBook(next, item.bookId);
        const before = book.quantity;
        const after = before + item.quantity;
        next = { ...next, books: next.books.map((entry) => entry.id === book.id ? changeStockLocation(entry, item.quantity, "Warehouse") : entry), movements: createMovement(next, book.id, "Purchase order received", before, after, `Purchase order ${order.id}`, role) };
      }
      next = { ...next, purchaseOrders: (next.purchaseOrders ?? []).map((item) => item.id === order.id ? { ...item, status: "Received", updatedAt: new Date().toISOString() } : item) };
      const invoiceNumber = action.invoiceNumber.trim();
      if (invoiceNumber.length < 1 || invoiceNumber.length > 100) throw new Error("Enter a valid supplier invoice number.");
      next = {
        ...next,
        invoices: [{
          id: newId("PI"),
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          invoiceNumber,
          total: order.total,
          receivedAt: new Date().toISOString(),
          receivedBy: actor,
        }, ...(next.invoices ?? [])],
      };
      return audit(next, actor, "Received purchase order", order.id, order.status, "Received");
    }
    case "addReview": {
      requireRole(role, ["Customer"]);
      if (!memberId || action.rating < 1 || action.rating > 5 || !Number.isInteger(action.rating) || action.text.trim().length < 3) throw new Error("Choose a 1–5 star rating and write a review of at least 3 characters.");
      const eligible = state.loans.some((loan) => loan.memberId === memberId && loan.bookId === action.bookId) || (state.sales ?? []).some((sale) => sale.memberId === memberId && sale.items.some((item) => item.bookId === action.bookId));
      if (!eligible) throw new Error("Only customers who borrowed or bought this book can review it.");
      if ((state.reviews ?? []).some((review) => review.bookId === action.bookId && review.memberId === memberId)) throw new Error("You have already reviewed this book.");
      next = { ...state, reviews: [{ id: newId("REV"), bookId: action.bookId, memberId, rating: action.rating, text: action.text.trim(), createdAt: new Date().toISOString() }, ...(state.reviews ?? [])] };
      break;
    }
    case "deleteReview": {
      requireRole(role, ["Manager"]);
      const review = (state.reviews ?? []).find((item) => item.id === action.reviewId);
      if (!review) throw new Error("Review not found.");
      next = { ...state, reviews: (state.reviews ?? []).filter((item) => item.id !== review.id) };
      return audit(next, actor, "Removed review", review.id);
    }
    case "updateSettings": {
      requireRole(role, ["Manager"]);
      const settings: LibrarySettings = { ...initialSettings, ...(state.settings ?? {}), ...action.settings };
      for (const [key, value] of Object.entries(settings)) {
        if (typeof value === "string" && value.length > 500) throw new Error(`${key} must be 500 characters or fewer.`);
      }
      if (settings.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.contactEmail)) {
        throw new Error("Enter a valid public contact email address.");
      }
      const numericValues = Object.values(settings).filter((value): value is number => typeof value === "number");
      if (numericValues.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0) || settings.loanDays < 1 || settings.membershipDays < 1 || settings.maxLoans < 1 || settings.maxReservations < 1 || settings.reservationHoldDays < 1 || settings.lowStockThreshold < 1 || settings.staffTimeoutMinutes < 1 || settings.customerTimeoutMinutes < 1) throw new Error("Enter valid positive policy values.");
      next = { ...state, settings };
      return audit(next, actor, "Updated system settings", "Library policies", JSON.stringify(state.settings), JSON.stringify(settings));
    }
    case "updateProfile": {
      if (role === "Customer" && !memberId) throw new Error("Your account has no membership profile.");
      const name = action.name.trim();
      const email = action.email.trim().toLowerCase();
      const phone = action.phone.trim();
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 6) throw new Error("Enter a valid name, email, and phone number.");
      if (state.members.some((item) => item.email === email && item.id !== memberId)) throw new Error("Another customer already uses this email address.");
      next = memberId
        ? { ...state, members: state.members.map((item) => item.id === memberId ? { ...item, name, email, phone } : item) }
        : state;
      break;
    }
    case "addCategory": {
      requireRole(role, ["Manager"]);
      const name = action.name.trim();
      if (name.length < 2 || name.length > 100) throw new Error("Category name must be between 2 and 100 characters.");
      if ((state.categories ?? []).some((item) => item.toLowerCase() === name.toLowerCase())) throw new Error("This category already exists.");
      next = { ...state, categories: [...(state.categories ?? []), name] };
      return audit(next, actor, "Added category", name);
    }
    case "softDeleteMovement": {
      requireRole(role, ["Warehouseman"]);
      const movement = state.movements.find((item) => item.id === action.movementId && !item.deletedAt);
      if (!movement) throw new Error("Stock movement not found.");
      const reason = requireReason(action.reason);
      next = {
        ...state,
        movements: state.movements.map((item) =>
          item.id === movement.id ? { ...item, deletedAt: new Date().toISOString(), reason: `${item.reason} (hidden: ${reason})` } : item,
        ),
      };
      return audit(next, actor, "Soft-deleted stock movement", movement.id, undefined, reason);
    }
    case "restoreMovement": {
      requireRole(role, ["Manager"]);
      const movement = state.movements.find((item) => item.id === action.movementId && item.deletedAt);
      if (!movement) throw new Error("Deleted stock movement not found.");
      next = {
        ...state,
        movements: state.movements.map((item) =>
          item.id === movement.id ? { ...item, deletedAt: undefined } : item,
        ),
      };
      return audit(next, actor, "Restored stock movement", movement.id);
    }
  }

  if (action.type === "addReview") next = audit(next, actor, "Added book review", action.bookId);
  if (action.type === "updateProfile") next = audit(next, actor, "Updated profile", memberId ?? actor);
  if (action.type === "reserve") next = audit(next, actor, "Created reservation", action.bookId);
  if (action.type === "requestBorrow") next = audit(next, actor, "Submitted borrow request", action.bookId);
  if (action.type === "approveRequest" || action.type === "rejectRequest") next = audit(next, actor, action.type === "approveRequest" ? "Approved borrow request" : "Rejected borrow request", action.requestId);
  if (action.type === "returnLoan") next = audit(next, actor, "Returned loan", action.loanId);
  if (action.type === "approveMembership") next = audit(next, actor, "Approved membership", action.memberId);
  if (action.type === "cancelReservation") next = audit(next, actor, "Cancelled reservation", action.reservationId);
  if (action.type === "decideRenewal") next = audit(next, actor, action.approve ? "Approved renewal" : "Rejected renewal", action.requestId);
  return next;
}

function moneyValue(amount: number): string {
  return `₪ ${amount.toFixed(2)}`;
}

const initialSettings: LibrarySettings = {
  loanDays: 14,
  finePerDay: 1,
  fineCapAtBookPrice: true,
  membershipDays: 365,
  membershipFee: 0,
  reservationHoldDays: 3,
  maxLoans: 3,
  maxReservations: 3,
  lowStockThreshold: 3,
  staffTimeoutMinutes: 15,
  customerTimeoutMinutes: 30,
  branchAddress: "",
  contactEmail: "",
  contactPhone: "",
  openingHours: "",
};
