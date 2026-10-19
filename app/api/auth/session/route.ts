import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        memberId: true,
        active: true,
        authVersion: true,
      },
    });
    if (!user || !user.active || user.authVersion !== session.authVersion) {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    return NextResponse.json({ user });
  } catch (error) {
    console.error("Unable to load the signed-in user:", error);
    return NextResponse.json(
      { error: "Could not verify your account. Please try again." },
      { status: 500 },
    );
  }
}
