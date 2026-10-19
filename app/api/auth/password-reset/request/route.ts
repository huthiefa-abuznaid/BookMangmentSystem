import { createHash, randomBytes } from "node:crypto";
import { AuthTokenPurpose } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.string().trim().email().max(254),
});
const genericResponse = {
  message: "If an account exists for that email, password reset instructions will be sent.",
};

export async function POST(request: Request) {
  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const emailApiUrl = process.env.EMAIL_API_URL;
    const emailApiKey = process.env.EMAIL_API_KEY;
    const emailFrom = process.env.EMAIL_FROM;
    const appBaseUrl = process.env.APP_BASE_URL;
    if (!emailApiUrl || !emailApiKey || !emailFrom || !appBaseUrl) {
      return NextResponse.json(
        { error: "Password reset email is not configured. Contact the library manager." },
        { status: 503 },
      );
    }
    const emailEndpoint = new URL(emailApiUrl);
    const trustedAppUrl = new URL(appBaseUrl);
    if (
      process.env.NODE_ENV === "production" &&
      (emailEndpoint.protocol !== "https:" || trustedAppUrl.protocol !== "https:")
    ) {
      return NextResponse.json(
        { error: "Password reset email requires HTTPS configuration in production." },
        { status: 503 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      select: { id: true, email: true, active: true },
    });
    if (!user?.active) return NextResponse.json(genericResponse);

    const cutoff = new Date(Date.now() - 60_000);
    const recentRequest = await prisma.authToken.findFirst({
      where: {
        userId: user.id,
        purpose: AuthTokenPurpose.PasswordReset,
        createdAt: { gt: cutoff },
      },
      select: { id: true },
    });
    if (recentRequest) return NextResponse.json(genericResponse);

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const resetToken = await prisma.authToken.create({
      data: {
        userId: user.id,
        purpose: AuthTokenPurpose.PasswordReset,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    try {
      const resetUrl = new URL("/", trustedAppUrl);
      resetUrl.searchParams.set("reset", token);
      const emailResponse = await fetch(emailEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${emailApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom,
          to: user.email,
          subject: "Reset your Shelf & Soul password",
          text: `Use this one-time link within 30 minutes to reset your password: ${resetUrl.toString()}`,
          html: `<p>Use this one-time link within 30 minutes to reset your password:</p><p><a href="${resetUrl.toString()}">Reset password</a></p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!emailResponse.ok) {
        throw new Error(`Email service returned HTTP ${emailResponse.status}.`);
      }
    } catch (error) {
      await prisma.authToken.delete({ where: { id: resetToken.id } });
      throw error;
    }

    return NextResponse.json(genericResponse);
  } catch (error) {
    console.error("Password reset request failed:", error);
    return NextResponse.json(
      { error: "Password reset is temporarily unavailable. Please try again." },
      { status: 500 },
    );
  }
}
