export type Role = "Manager" | "Receptionist" | "Warehouseman" | "Customer";
export type BookCondition = "New" | "Good" | "Fair" | "Poor" | "Damaged";
export type ReservationStatus =
  | "Queued"
  | "Ready for pickup"
  | "Collected"
  | "Cancelled"
  | "Expired";
export type RequestStatus = "Pending" | "Approved" | "Rejected";
export type PaymentMethod = "Cash" | "Cash on pickup";
export type OrderStatus = "Pending" | "Ready" | "Collected" | "Cancelled";
export type StockLocation = "Warehouse" | "Library floor";
export type StockByLocation = Record<StockLocation, number>;

export type LibraryAction =
  | { type: "reserve"; bookId: string; memberId?: string }
  | { type: "requestBorrow"; bookId: string }
  | { type: "approveRequest"; requestId: string }
  | { type: "rejectRequest"; requestId: string }
  | { type: "returnLoan"; loanId: string; condition?: BookCondition }
  | { type: "checkoutLoan"; bookId: string; memberId: string }
  | { type: "markNoticeRead"; noticeId: string }
  | { type: "markAllRead" }
  | { type: "approveMembership"; memberId: string }
  | { type: "saveMember"; member: Omit<Member, "id" | "unpaidFines"> & { id?: string } }
  | { type: "cancelReservation"; reservationId: string }
  | { type: "requestRenewal"; loanId: string }
  | { type: "decideRenewal"; requestId: string; approve: boolean }
  | { type: "saveBook"; book: Omit<Book, "id"> & { id?: string } }
  | { type: "deleteBook"; bookId: string }
  | { type: "restoreBook"; bookId: string }
  | { type: "adjustStock"; bookId: string; quantity: number; reason: string }
  | { type: "recordStockLoss"; bookId: string; quantity: number; lossType: "Damaged" | "Lost"; reason: string }
  | { type: "transferStock"; bookId: string; quantity: number; from: StockLocation; to: StockLocation; reason: string }
  | { type: "createSale"; items: { bookId: string; quantity: number }[]; paymentMethod: "Cash" | "Cash on pickup"; customerId?: string }
  | { type: "updateOrder"; orderId: string; status: "Ready" | "Collected" | "Cancelled" }
  | { type: "collectFinePayment"; memberId: string; amount: number }
  | { type: "adjustFine"; memberId: string; amount: number; reason: string }
  | { type: "saveSupplier"; supplier: Omit<Supplier, "id"> & { id?: string } }
  | { type: "createPurchaseOrder"; supplierId: string; items: { bookId: string; quantity: number; unitPrice: number }[] }
  | { type: "decidePurchaseOrder"; orderId: string; status: "Approved" | "Sent" | "Cancelled" }
  | { type: "receivePurchaseOrder"; orderId: string; invoiceNumber: string }
  | { type: "addReview"; bookId: string; rating: number; text: string }
  | { type: "deleteReview"; reviewId: string }
  | { type: "updateSettings"; settings: Partial<LibrarySettings> }
  | { type: "updateProfile"; name: string; email: string; phone: string }
  | { type: "addCategory"; name: string }
  | { type: "softDeleteMovement"; movementId: string; reason: string }
  | { type: "restoreMovement"; movementId: string };

export interface Book {
  id: string;
  title: string;
  author: string;
  category: string;
  isbn: string;
  description: string;
  condition: BookCondition;
  price: number;
  quantity: number;
  cover: string;
  forSale: boolean;
  deletedAt?: string;
  stockThreshold?: number;
  location?: "Warehouse" | "Library floor";
  stockByLocation?: StockByLocation;
  damagedQuantity?: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  phone: string;
  membershipStatus: "Active" | "Expired" | "Pending";
  membershipExpiresAt: string;
  unpaidFines: number;
}

export interface Loan {
  id: string;
  bookId: string;
  memberId: string;
  issuedAt: string;
  dueAt: string;
  returnedAt?: string;
  renewals: number;
  status: "Active" | "Returned";
}

export interface BorrowRequest {
  id: string;
  bookId: string;
  memberId: string;
  requestedAt: string;
  status: RequestStatus;
}

export interface Reservation {
  id: string;
  bookId: string;
  memberId: string;
  createdAt: string;
  holdUntil?: string;
  status: ReservationStatus;
}

export interface StockMovement {
  id: string;
  bookId: string;
  type: string;
  before: number;
  after: number;
  reason: string;
  employee: string;
  createdAt: string;
  deletedAt?: string;
}

export interface Notice {
  id: string;
  message: string;
  createdAt: string;
  read: boolean;
  memberId?: string;
}

export interface RenewalRequest {
  id: string;
  loanId: string;
  requestedAt: string;
  status: RequestStatus;
}

export interface Sale {
  id: string;
  memberId: string;
  items: { bookId: string; quantity: number; unitPrice: number }[];
  total: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  paymentStatus: "Unpaid" | "Paid";
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  items: { bookId: string; quantity: number; unitPrice: number }[];
  total: number;
  status: "Suggested" | "Approved" | "Sent" | "Received" | "Cancelled";
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface BookReview {
  id: string;
  bookId: string;
  memberId: string;
  rating: number;
  text: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  item: string;
  before?: string;
  after?: string;
  createdAt: string;
}

export interface LibrarySettings {
  loanDays: number;
  finePerDay: number;
  fineCapAtBookPrice: boolean;
  membershipDays: number;
  membershipFee: number;
  reservationHoldDays: number;
  maxLoans: number;
  maxReservations: number;
  lowStockThreshold: number;
  staffTimeoutMinutes: number;
  customerTimeoutMinutes: number;
  branchAddress: string;
  contactEmail: string;
  contactPhone: string;
  openingHours: string;
}

export interface LibraryState {
  books: Book[];
  members: Member[];
  loans: Loan[];
  requests: BorrowRequest[];
  reservations: Reservation[];
  movements: StockMovement[];
  notices: Notice[];
  renewals?: RenewalRequest[];
  sales?: Sale[];
  suppliers?: Supplier[];
  purchaseOrders?: PurchaseOrder[];
  reviews?: BookReview[];
  auditLog?: AuditEntry[];
  invoices?: PurchaseInvoice[];
  categories?: string[];
  settings?: LibrarySettings;
}

export interface PurchaseInvoice {
  id: string;
  purchaseOrderId: string;
  supplierId: string;
  invoiceNumber: string;
  total: number;
  receivedAt: string;
  receivedBy: string;
}
