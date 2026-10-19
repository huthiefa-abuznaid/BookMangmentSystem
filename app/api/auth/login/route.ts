import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/auth-validation";
import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input: unknown = await request.json();
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a valid email and password." },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (
      !user ||
      !user.active ||
      !(await bcrypt.compare(parsed.data.password, user.passwordHash))
    ) {
      return NextResponse.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      );
    }

    const token = await createSessionToken({
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      memberId: user.memberId,
      authVersion: user.authVersion,
    });
    const response = NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        memberId: user.memberId,
      },
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    console.error("Sign in failed:", error);
    return NextResponse.json(
      { error: "Sign in is temporarily unavailable. Please try again." },
      { status: 500 },
    );
  }
}
