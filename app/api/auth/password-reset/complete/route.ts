import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { AuthTokenPurpose } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { passwordSchema } from "@/lib/auth-validation";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const completeSchema = z.object({
  token: z.string().min(32).max(128),
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

export async function POST(request: Request) {
  try {
    const parsed = completeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Check your password and try again." },
        { status: 400 },
      );
    }
    const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
    const token = await prisma.authToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true },
    });
    if (
      !token ||
      token.purpose !== AuthTokenPurpose.PasswordReset ||
      token.usedAt ||
      token.expiresAt.getTime() <= Date.now()
    ) {
      return NextResponse.json(
        { error: "This password reset link is invalid or expired. Request a new one." },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.authToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("This password reset link was already used or expired.");
      await transaction.user.update({
        where: { id: token.userId },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await transaction.authToken.deleteMany({
        where: { userId: token.userId, purpose: AuthTokenPurpose.PasswordReset, id: { not: token.id } },
      });
    });
    return NextResponse.json({ message: "Password updated. You can now sign in." });
  } catch (error) {
    console.error("Password reset completion failed:", error);
    return NextResponse.json(
      { error: error instanceof Error && error.message.includes("already used or expired")
        ? error.message
        : "Password reset is temporarily unavailable. Please try again." },
      { status: error instanceof Error && error.message.includes("already used or expired") ? 400 : 500 },
    );
  }
}
