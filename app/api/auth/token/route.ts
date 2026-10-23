import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/auth-validation";
import { prisma } from "@/lib/prisma";
import { createSessionToken } from "@/lib/session";

export const runtime = "nodejs";

const TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Enter a valid email and password." },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.trim().toLowerCase() },
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

    const accessToken = await createSessionToken({
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      memberId: user.memberId,
      authVersion: user.authVersion,
    });
    return NextResponse.json(
      {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: TOKEN_LIFETIME_SECONDS,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          memberId: user.memberId,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Access token generation failed:", error);
    return NextResponse.json(
      { error: "Token generation is temporarily unavailable. Please try again." },
      { status: 500 },
    );
  }
}
