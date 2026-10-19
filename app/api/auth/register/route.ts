import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { registerSchema } from "@/lib/auth-validation";
import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";
import type { LibraryState } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input: unknown = await request.json();
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Check the registration details.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const email = parsed.data.email.toLowerCase();
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const created = await prisma.$transaction(async (transaction) => {
      const snapshot = await transaction.librarySnapshot.findUnique({
        where: { id: "primary" },
      });
      if (!snapshot) throw new Error("Library database has not been initialized.");

      const state = snapshot.state as unknown as LibraryState;
      const existingMember = state.members.find((item) => item.email.toLowerCase() === email);
      const memberId = existingMember?.id ?? `m-${crypto.randomUUID()}`;
      const member = existingMember
        ? { ...existingMember, name: parsed.data.name, email, phone: parsed.data.phone }
        : {
            id: memberId,
            name: parsed.data.name,
            email,
            phone: parsed.data.phone,
            membershipStatus: "Pending" as const,
            membershipExpiresAt: new Date(Date.now() + (state.settings?.membershipDays ?? 365) * 86_400_000).toISOString(),
            unpaidFines: 0,
          };
      const user = await transaction.user.create({
        data: {
          name: parsed.data.name,
          email,
          phone: parsed.data.phone,
          passwordHash,
          role: "Customer",
          memberId,
        },
      });
      await transaction.librarySnapshot.update({
        where: { id: "primary" },
        data: {
          revision: { increment: 1 },
          state: {
            ...state,
            members: existingMember
              ? state.members.map((item) => item.id === existingMember.id ? member : item)
              : [...state.members, member],
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return user;
    });

    const token = await createSessionToken({
      userId: created.id,
      name: created.name,
      email: created.email,
      phone: created.phone,
      role: created.role,
      memberId: created.memberId,
      authVersion: created.authVersion,
    });
    const response = NextResponse.json(
      {
        user: {
          id: created.id,
          name: created.name,
          email: created.email,
          role: created.role,
          memberId: created.memberId,
        },
      },
      { status: 201 },
    );
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "An account with this email address already exists." },
        { status: 409 },
      );
    }
    console.error("Account registration failed:", error);
    return NextResponse.json(
      { error: "Account registration failed. Please try again." },
      { status: 500 },
    );
  }
}
