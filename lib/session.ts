import { randomUUID } from "node:crypto";
import { errors as joseErrors, SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { initialLibraryState, normalizeLibraryState } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import type { LibraryState, Role } from "@/lib/types";

export const SESSION_COOKIE = "shelf-and-soul-session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export interface UserSession {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  memberId: string | null;
  authVersion: number;
}

type NewUserSession = Omit<UserSession, "sessionId">;

function getSessionKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be configured with at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(session: NewUserSession): Promise<string> {
  const sessionId = randomUUID();
  const now = new Date();
  await prisma.authSession.create({
    data: {
      id: sessionId,
      userId: session.userId,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE * 1000),
    },
  });

  try {
    return await new SignJWT({
      name: session.name,
      email: session.email,
      phone: session.phone,
      role: session.role,
      memberId: session.memberId,
      authVersion: session.authVersion,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(session.userId)
      .setJti(sessionId)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_MAX_AGE}s`)
      .sign(getSessionKey());
  } catch (error) {
    await prisma.authSession.delete({ where: { id: sessionId } });
    throw error;
  }
}

export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const authorization = (await headers()).get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const token = authorization
    ? bearerToken
    : cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let payload;
  try {
    ({ payload } = await jwtVerify(token, getSessionKey()));
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return null;
    throw error;
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.name !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.phone !== "string" ||
    !isRole(payload.role) ||
    (payload.memberId !== null && typeof payload.memberId !== "string") ||
    typeof payload.authVersion !== "number" ||
    !Number.isInteger(payload.authVersion)
  ) {
    return null;
  }

  const authSession = await prisma.authSession.findUnique({
    where: { id: payload.jti },
    include: {
      user: {
        select: { active: true, authVersion: true, role: true },
      },
    },
  });
  if (
    !authSession ||
    authSession.userId !== payload.sub ||
    !authSession.user.active ||
    authSession.user.authVersion !== payload.authVersion
  ) {
    if (authSession) {
      await prisma.authSession.deleteMany({ where: { id: authSession.id } });
    }
    return null;
  }

  const snapshot = await prisma.librarySnapshot.findUnique({
    where: { id: "primary" },
    select: { state: true },
  });
  const state = snapshot
    ? normalizeLibraryState(snapshot.state as unknown as LibraryState)
    : initialLibraryState;
  const defaultTimeoutMinutes = authSession.user.role === "Customer" ? 30 : 15;
  const configuredTimeoutMinutes = authSession.user.role === "Customer"
    ? state.settings?.customerTimeoutMinutes ?? 30
    : state.settings?.staffTimeoutMinutes ?? 15;
  const timeoutMinutes = Number.isSafeInteger(configuredTimeoutMinutes) &&
    configuredTimeoutMinutes > 0
    ? configuredTimeoutMinutes
    : defaultTimeoutMinutes;
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - timeoutMinutes * 60_000);
  const activity = await prisma.authSession.updateMany({
    where: {
      id: authSession.id,
      expiresAt: { gt: now },
      lastActivityAt: { gt: idleCutoff },
    },
    data: { lastActivityAt: now },
  });
  if (activity.count !== 1) {
    await prisma.authSession.deleteMany({
      where: { id: authSession.id, lastActivityAt: { lte: idleCutoff } },
    });
    return null;
  }

  return {
    sessionId: authSession.id,
    userId: payload.sub,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    role: authSession.user.role,
    memberId: payload.memberId,
    authVersion: payload.authVersion,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.authSession.deleteMany({ where: { id: sessionId } });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

function isRole(value: unknown): value is Role {
  return (
    value === "Manager" ||
    value === "Receptionist" ||
    value === "Warehouseman" ||
    value === "Customer"
  );
}
