import { NextResponse } from "next/server";
import {
  getSession,
  revokeSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  try {
    const session = await getSession();
    if (session) await revokeSession(session.sessionId);
  } catch (error) {
    console.error("Unable to revoke the signed-out session:", error);
  }
  return response;
}
