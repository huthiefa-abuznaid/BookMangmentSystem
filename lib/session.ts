import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/lib/types";

export const SESSION_COOKIE = "shelf-and-soul-session";
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export interface UserSession {
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  memberId: string | null;
  authVersion: number;
}

function getSessionKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be configured with at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(session: UserSession): Promise<string> {
  return new SignJWT({
    name: session.name,
    email: session.email,
    phone: session.phone,
    role: session.role,
    memberId: session.memberId,
    authVersion: session.authVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSessionKey());
}

export async function getSession(): Promise<UserSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionKey());
    if (
      typeof payload.sub !== "string" ||
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
    return {
      userId: payload.sub,
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      role: payload.role,
      memberId: payload.memberId,
      authVersion: payload.authVersion,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "JWTExpired") return null;
    throw new Error("The sign-in session could not be verified.");
  }
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
