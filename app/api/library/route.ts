import { Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveUser } from "@/lib/api-auth";
import { normalizeLibraryState } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import {
  executeLibraryAction,
} from "@/lib/library-service";
import type { LibraryAction, LibraryState, Role } from "@/lib/types";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reserve"), bookId: z.string().min(1), memberId: z.string().optional() }),
  z.object({ type: z.literal("requestBorrow"), bookId: z.string().min(1) }),
  z.object({ type: z.literal("approveRequest"), requestId: z.string().min(1) }),
  z.object({ type: z.literal("rejectRequest"), requestId: z.string().min(1) }),
  z.object({ type: z.literal("returnLoan"), loanId: z.string().min(1), condition: z.enum(["New", "Good", "Fair", "Poor", "Damaged"]).optional() }),
  z.object({ type: z.literal("checkoutLoan"), bookId: z.string().min(1), memberId: z.string().min(1) }),
  z.object({ type: z.literal("markNoticeRead"), noticeId: z.string().min(1) }),
  z.object({ type: z.literal("markAllRead") }),
  z.object({ type: z.literal("approveMembership"), memberId: z.string().min(1) }),
  z.object({ type: z.literal("saveMember"), member: z.object({
    id: z.string().optional(), name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().max(254), phone: z.string().trim().min(6).max(30),
    membershipStatus: z.enum(["Active", "Expired", "Pending"]),
    membershipExpiresAt: z.string().datetime(),
  }) }),
  z.object({ type: z.literal("cancelReservation"), reservationId: z.string().min(1) }),
  z.object({ type: z.literal("requestRenewal"), loanId: z.string().min(1) }),
  z.object({ type: z.literal("decideRenewal"), requestId: z.string().min(1), approve: z.boolean() }),
  z.object({ type: z.literal("saveBook"), book: z.object({
    id: z.string().optional(), title: z.string().max(200), author: z.string().max(200),
    category: z.string().max(100), isbn: z.string().max(32), description: z.string().max(5000),
    condition: z.enum(["New", "Good", "Fair", "Poor", "Damaged"]), price: z.number().nonnegative(),
    quantity: z.number().int().nonnegative(), cover: z.string().max(2_800_000), forSale: z.boolean(),
    stockThreshold: z.number().int().positive().optional(),
    location: z.enum(["Warehouse", "Library floor"]).optional(),
    damagedQuantity: z.number().int().nonnegative().optional(),
  }) }),
  z.object({ type: z.literal("deleteBook"), bookId: z.string().min(1) }),
  z.object({ type: z.literal("restoreBook"), bookId: z.string().min(1) }),
  z.object({ type: z.literal("adjustStock"), bookId: z.string().min(1), quantity: z.number().int(), reason: z.string().max(500) }),
  z.object({ type: z.literal("recordStockLoss"), bookId: z.string().min(1), quantity: z.number().int().positive(), lossType: z.enum(["Damaged", "Lost"]), reason: z.string().trim().min(3).max(500) }),
  z.object({ type: z.literal("transferStock"), bookId: z.string().min(1), quantity: z.number().int().positive(), from: z.enum(["Warehouse", "Library floor"]), to: z.enum(["Warehouse", "Library floor"]), reason: z.string().trim().min(3).max(500) }),
  z.object({ type: z.literal("createSale"), items: z.array(z.object({ bookId: z.string().min(1), quantity: z.number().int().positive() })).min(1), paymentMethod: z.enum(["Cash", "Cash on pickup"]), customerId: z.string().optional() }),
  z.object({ type: z.literal("updateOrder"), orderId: z.string().min(1), status: z.enum(["Ready", "Collected", "Cancelled"]) }),
  z.object({ type: z.literal("collectFinePayment"), memberId: z.string().min(1), amount: z.number().positive() }),
  z.object({ type: z.literal("adjustFine"), memberId: z.string().min(1), amount: z.number(), reason: z.string().max(500) }),
  z.object({ type: z.literal("saveSupplier"), supplier: z.object({ id: z.string().optional(), name: z.string().max(200), phone: z.string().max(50), address: z.string().max(500) }) }),
  z.object({ type: z.literal("createPurchaseOrder"), supplierId: z.string().min(1), items: z.array(z.object({ bookId: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().nonnegative() })).min(1) }),
  z.object({ type: z.literal("decidePurchaseOrder"), orderId: z.string().min(1), status: z.enum(["Approved", "Sent", "Cancelled"]) }),
  z.object({ type: z.literal("receivePurchaseOrder"), orderId: z.string().min(1), invoiceNumber: z.string().trim().min(1).max(100) }),
  z.object({ type: z.literal("addReview"), bookId: z.string().min(1), rating: z.number().int().min(1).max(5), text: z.string().max(2000) }),
  z.object({ type: z.literal("deleteReview"), reviewId: z.string().min(1) }),
  z.object({ type: z.literal("updateSettings"), settings: z.object({
    loanDays: z.number().int().positive().optional(), finePerDay: z.number().nonnegative().optional(),
    fineCapAtBookPrice: z.boolean().optional(), membershipDays: z.number().int().positive().optional(),
    membershipFee: z.number().nonnegative().optional(), reservationHoldDays: z.number().int().positive().optional(),
    maxLoans: z.number().int().positive().optional(), maxReservations: z.number().int().positive().optional(),
    lowStockThreshold: z.number().int().positive().optional(), staffTimeoutMinutes: z.number().int().positive().optional(),
    customerTimeoutMinutes: z.number().int().positive().optional(),
    branchAddress: z.string().max(500).optional(),
    contactEmail: z.string().max(254).optional(),
    contactPhone: z.string().max(50).optional(),
    openingHours: z.string().max(500).optional(),
  }) }),
  z.object({ type: z.literal("updateProfile"), name: z.string().max(100), email: z.string().email().max(254), phone: z.string().max(30) }),
  z.object({ type: z.literal("addCategory"), name: z.string().max(100) }),
  z.object({ type: z.literal("softDeleteMovement"), movementId: z.string().min(1), reason: z.string().max(500) }),
  z.object({ type: z.literal("restoreMovement"), movementId: z.string().min(1) }),
]);

function forUser(state: LibraryState, role: UserRole, memberId: string | null): LibraryState {
  if (role !== UserRole.Customer) return state;
  return {
    ...state,
    members: memberId
      ? state.members.filter((member) => member.id === memberId)
      : [],
    loans: state.loans.filter((loan) => loan.memberId === memberId),
    requests: state.requests.filter((request) => request.memberId === memberId),
    reservations: state.reservations.filter((reservation) => reservation.memberId === memberId),
    renewals: (state.renewals ?? []).filter((request) =>
      state.loans.some((loan) => loan.id === request.loanId && loan.memberId === memberId),
    ),
    sales: (state.sales ?? []).filter((sale) => sale.memberId === memberId),
    movements: [],
    notices: state.notices.filter((notice) => notice.memberId === memberId),
    suppliers: [],
    purchaseOrders: [],
    invoices: [],
    auditLog: [],
  };
}

export async function GET() {
  try {
    const user = await getActiveUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in to access the library." }, { status: 401 });
    }
    const snapshot = await prisma.librarySnapshot.findUnique({
      where: { id: "primary" },
    });
    if (!snapshot) {
      return NextResponse.json(
        { error: "The library database is not initialized. Run the database setup steps." },
        { status: 503 },
      );
    }
    const state = normalizeLibraryState(snapshot.state as unknown as LibraryState);
    return NextResponse.json({ state: forUser(state, user.role, user.memberId) });
  } catch (error) {
    console.error("Unable to load library data:", error);
    return NextResponse.json(
      { error: "Could not load library data. Check the database connection and try again." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getActiveUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in to make library changes." }, { status: 401 });
    }
    const body: unknown = await request.json();
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "The requested library action is invalid." }, { status: 400 });
    }

    const snapshot = await prisma.librarySnapshot.findUnique({
      where: { id: "primary" },
    });
    if (!snapshot) {
      return NextResponse.json(
        { error: "The library database is not initialized. Run the database setup steps." },
        { status: 503 },
      );
    }
    const state = normalizeLibraryState(snapshot.state as unknown as LibraryState);
    const role = user.role as Role;
    const permissionKey = ({
    saveBook: "catalog",
    deleteBook: "catalog",
    restoreBook: "catalog",
    addCategory: "catalog",
    reserve: "reservations",
    cancelReservation: "reservations",
    requestBorrow: "loans",
    approveRequest: "loans",
    rejectRequest: "loans",
    returnLoan: "loans",
    checkoutLoan: "loans",
    requestRenewal: "loans",
    decideRenewal: "loans",
    createSale: "sales",
    updateOrder: "sales",
    collectFinePayment: "fines",
    adjustFine: "fines",
    adjustStock: "inventory",
    recordStockLoss: "inventory",
    transferStock: "inventory",
    softDeleteMovement: "inventory",
    restoreMovement: "inventory",
    saveSupplier: "purchasing",
    createPurchaseOrder: "purchasing",
    decidePurchaseOrder: "purchasing",
    receivePurchaseOrder: "purchasing",
    addReview: "reviews",
    deleteReview: "reviews",
    updateSettings: "settings",
    approveMembership: "memberships",
    saveMember: "memberships",
    markNoticeRead: "notifications",
    markAllRead: "notifications",
    updateProfile: "profile",
    } as const)[parsed.data.type];
    if (
    user.role !== UserRole.Manager &&
    permissionKey &&
    typeof user.permissions === "object" &&
    user.permissions !== null &&
    !Array.isArray(user.permissions) &&
    permissionKey in user.permissions &&
    user.permissions[permissionKey] === false
    ) {
    return NextResponse.json({ error: "This staff account does not have permission to perform this action." }, { status: 403 });
    }
    let next: LibraryState;
    try {
      next = executeLibraryAction(state, parsed.data as LibraryAction, role, user.memberId, user.name);
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const updateCount = await prisma.$transaction(async (transaction) => {
      const update = await transaction.librarySnapshot.updateMany({
        where: { id: "primary", revision: snapshot.revision },
        data: {
          revision: { increment: 1 },
          state: next as unknown as Prisma.InputJsonValue,
        },
      });
      if (update.count === 1 && parsed.data.type === "updateProfile") {
        await transaction.user.update({
          where: { id: user.id },
          data: {
            name: parsed.data.name.trim(),
            email: parsed.data.email.trim().toLowerCase(),
            phone: parsed.data.phone.trim(),
          },
        });
      }
      if (update.count === 1 && parsed.data.type === "saveMember" && parsed.data.member.id) {
        const userAccount = await transaction.user.findUnique({
          where: { memberId: parsed.data.member.id },
          select: { id: true },
        });
        if (userAccount) {
          await transaction.user.update({
            where: { id: userAccount.id },
            data: {
              name: parsed.data.member.name.trim(),
              email: parsed.data.member.email.trim().toLowerCase(),
              phone: parsed.data.member.phone.trim(),
            },
          });
        }
      }
      return update.count;
    });
    if (updateCount !== 1) {
      return NextResponse.json(
        { error: "Another library change was saved first. Refresh and try again." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      state: forUser(next, user.role, user.memberId),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Another account already uses this email address." },
        { status: 409 },
      );
    }
    console.error("Library action failed:", error);
    return NextResponse.json(
      { error: "The library action could not be completed. Please try again." },
      { status: 500 },
    );
  }
}
