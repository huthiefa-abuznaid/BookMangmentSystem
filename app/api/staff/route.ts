import bcrypt from "bcryptjs";
import { Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { AuditEntry, LibraryState } from "@/lib/types";

export const runtime = "nodejs";

function withStaffAudit(stateValue: unknown, entry: AuditEntry): LibraryState {
  const state = stateValue as LibraryState;
  return { ...state, auditLog: [entry, ...(state.auditLog ?? [])] };
}

function staffAudit(actor: string, action: string, item: string, before?: string, after?: string): AuditEntry {
  return {
    id: `AUD-${crypto.randomUUID()}`,
    actor,
    action,
    item,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    createdAt: new Date().toISOString(),
  };
}

const staffInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(6).max(30),
  role: z.nativeEnum(UserRole).refine((value) => value !== UserRole.Customer),
  password: z.string().min(12).max(128).optional(),
});

const updateInput = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(6).max(30).optional(),
  role: z.nativeEnum(UserRole).refine((value) => value !== UserRole.Customer).optional(),
  active: z.boolean().optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  password: z.string().min(12).max(128).optional(),
});

async function managerOnly() {
  const user = await getActiveUser();
  return user?.role === UserRole.Manager ? user : null;
}

export async function GET() {
  try {
    if (!(await managerOnly())) {
      return NextResponse.json({ error: "Manager access is required." }, { status: 403 });
    }
    const users = await prisma.user.findMany({
      where: { role: { not: UserRole.Customer } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        active: true,
        permissions: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Unable to load staff accounts:", error);
    return NextResponse.json({ error: "Could not load staff accounts." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const manager = await managerOnly();
    if (!manager) {
      return NextResponse.json({ error: "Manager access is required." }, { status: 403 });
    }
    const parsed = staffInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the staff account details." }, { status: 400 });
    }
    if (!parsed.data.password) {
      return NextResponse.json({ error: "Set a temporary password of at least 12 characters." }, { status: 400 });
    }
    const temporaryPassword = parsed.data.password;
    const user = await prisma.$transaction(async (transaction) => {
      const snapshot = await transaction.librarySnapshot.findUnique({ where: { id: "primary" } });
      if (!snapshot) throw new Error("Library database has not been initialized.");
      const created = await transaction.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email.toLowerCase(),
          phone: parsed.data.phone,
          passwordHash: await bcrypt.hash(temporaryPassword, 12),
          role: parsed.data.role,
          active: true,
          permissions: {},
        },
        select: { id: true, name: true, email: true, phone: true, role: true, active: true, permissions: true, createdAt: true },
      });
      const updatedState = withStaffAudit(snapshot.state, staffAudit(manager.name, "Created staff account", created.email, undefined, JSON.stringify({ role: created.role, active: created.active })));
      await transaction.librarySnapshot.update({
        where: { id: "primary" },
        data: { revision: { increment: 1 }, state: updatedState as unknown as Prisma.InputJsonValue },
      });
      return created;
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    console.error("Unable to create staff account:", error);
    return NextResponse.json({ error: "Could not create staff account." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const manager = await managerOnly();
    if (!manager) {
      return NextResponse.json({ error: "Manager access is required." }, { status: 403 });
    }
    const parsed = updateInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the staff account details." }, { status: 400 });
    }
    if (parsed.data.userId === manager.id && parsed.data.active === false) {
      return NextResponse.json({ error: "You cannot deactivate your own manager account." }, { status: 400 });
    }
    const target = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, name: true, email: true, phone: true, role: true, active: true, permissions: true } });
    if (!target || target.role === UserRole.Customer) {
      return NextResponse.json({ error: "Staff account not found." }, { status: 404 });
    }
    const data: Prisma.UserUpdateInput = {
      ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
      ...(parsed.data.email === undefined ? {} : { email: parsed.data.email.toLowerCase() }),
      ...(parsed.data.phone === undefined ? {} : { phone: parsed.data.phone }),
      ...(parsed.data.role === undefined ? {} : { role: parsed.data.role }),
      ...(parsed.data.active === undefined ? {} : { active: parsed.data.active }),
      ...(parsed.data.permissions === undefined ? {} : { permissions: parsed.data.permissions as Prisma.InputJsonValue }),
      ...(parsed.data.password === undefined ? {} : { passwordHash: await bcrypt.hash(parsed.data.password, 12) }),
      ...(parsed.data.password === undefined ? {} : { authVersion: { increment: 1 } }),
    };
    const user = await prisma.$transaction(async (transaction) => {
      const snapshot = await transaction.librarySnapshot.findUnique({ where: { id: "primary" } });
      if (!snapshot) throw new Error("Library database has not been initialized.");
      const updated = await transaction.user.update({
        where: { id: parsed.data.userId },
        data,
        select: { id: true, name: true, email: true, phone: true, role: true, active: true, permissions: true, createdAt: true },
      });
      const before = JSON.stringify({ name: target.name, email: target.email, phone: target.phone, role: target.role, active: target.active, permissions: target.permissions });
      const after = JSON.stringify({ name: updated.name, email: updated.email, phone: updated.phone, role: updated.role, active: updated.active, permissions: updated.permissions });
      const updatedState = withStaffAudit(snapshot.state, staffAudit(manager.name, "Updated staff account", updated.email, before, after));
      await transaction.librarySnapshot.update({
        where: { id: "primary" },
        data: { revision: { increment: 1 }, state: updatedState as unknown as Prisma.InputJsonValue },
      });
      return updated;
    });
    const currentSession = await getSession();
    if (currentSession?.userId === user.id && !user.active) {
      const response = NextResponse.json({ user });
      response.cookies.delete("shelf-and-soul-session");
      return response;
    }
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Another account already uses this email address." }, { status: 409 });
    }
    console.error("Unable to update staff account:", error);
    return NextResponse.json({ error: "Could not update staff account." }, { status: 500 });
  }
}
