"use client";

import { initialLibraryState, normalizeLibraryState } from "@/lib/demo-data";
import {
  executeLibraryAction,
} from "@/lib/library-service";
import { passwordSchema, registerSchema } from "@/lib/auth-validation";
import type { LibraryAction, LibraryState, Role } from "@/lib/types";

export interface PrototypeUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  memberId: string | null;
}

interface StoredUser extends PrototypeUser {
  passwordHash: string;
  passwordSalt: string;
  active: boolean;
  permissions: Record<string, boolean>;
  createdAt: string;
}

export type PrototypeStaff = Omit<
  Pick<StoredUser, "id" | "name" | "email" | "phone" | "role" | "active" | "permissions" | "createdAt">,
  "role"
> & { role: Exclude<Role, "Customer"> };

const LIBRARY_KEY = "shelf-and-soul-prototype-library";
const USERS_KEY = "shelf-and-soul-prototype-users";
const SESSION_KEY = "shelf-and-soul-prototype-session";
const RESET_KEY = "shelf-and-soul-prototype-password-reset";
const DEMO_PASSWORD = "ShelfSoulDemo2026!";
const HASH_ITERATIONS = 120_000;

function readJson<T>(key: string, fallback: T): T {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    throw new Error(
      "Browser storage is unavailable. Enable Local Storage and reload the prototype.",
    );
  }
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      "Prototype data is unreadable. Clear this site's Local Storage and reload.",
    );
  }
}

function hasStoredValue(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    throw new Error(
      "Browser storage is unavailable. Enable Local Storage and reload the prototype.",
    );
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error(
      "Could not save prototype data. Check browser storage availability and space.",
    );
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordDigest(password: string, salt: ArrayBuffer): Promise<string> {
  const key = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: HASH_ITERATIONS,
    },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

function fromHex(value: string): ArrayBuffer {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) {
    throw new Error("Prototype account data is invalid. Clear this site's Local Storage.");
  }
  const buffer = new ArrayBuffer(value.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return buffer;
}

async function createStoredUser(
  user: PrototypeUser & { phone: string },
  password: string,
): Promise<StoredUser> {
  const salt = new ArrayBuffer(16);
  window.crypto.getRandomValues(new Uint8Array(salt));
  return {
    ...user,
    active: true,
    permissions: {},
    createdAt: new Date().toISOString(),
    passwordSalt: toHex(new Uint8Array(salt)),
    passwordHash: await passwordDigest(password, salt),
  };
}

function getUsers(): StoredUser[] {
  return readJson<StoredUser[]>(USERS_KEY, []).map((user) => ({
    ...user,
    active: user.active ?? true,
    permissions: user.permissions ?? {},
    createdAt: user.createdAt ?? new Date().toISOString(),
  }));
}

function publicUser(user: StoredUser): PrototypeUser {
  const { id, name, email, phone, role, memberId } = user;
  return { id, name, email, phone, role, memberId };
}

function isRole(value: unknown): value is Role {
  return (
    value === "Manager" ||
    value === "Receptionist" ||
    value === "Warehouseman" ||
    value === "Customer"
  );
}

export async function initializePrototype(): Promise<void> {
  if (!hasStoredValue(LIBRARY_KEY)) {
    writeJson(LIBRARY_KEY, initialLibraryState);
  }

  if (hasStoredValue(USERS_KEY)) return;

  const demoUsers: Array<PrototypeUser & { phone: string }> = [
    {
      id: "prototype-manager",
      name: "Library Manager",
      email: "manager@shelfandsoul.local",
      phone: "+970 2 000 0000",
      role: "Manager",
      memberId: null,
    },
    {
      id: "prototype-receptionist",
      name: "Noor Ahmad",
      email: "receptionist@shelfandsoul.local",
      phone: "+970 2 000 0001",
      role: "Receptionist",
      memberId: null,
    },
    {
      id: "prototype-warehouse",
      name: "Rami Saleh",
      email: "warehouse@shelfandsoul.local",
      phone: "+970 2 000 0002",
      role: "Warehouseman",
      memberId: null,
    },
    {
      id: "prototype-customer",
      name: "Lina Khalil",
      email: "lina@example.com",
      phone: "+970 599 123 456",
      role: "Customer",
      memberId: "m-001",
    },
  ];
  const users = await Promise.all(
    demoUsers.map((user) => createStoredUser(user, DEMO_PASSWORD)),
  );
  writeJson(USERS_KEY, users);
}

export async function getPrototypeSession(): Promise<PrototypeUser | null> {
  await initializePrototype();
  const session = readJson<PrototypeUser | null>(SESSION_KEY, null);
  if (
    !session ||
    typeof session.id !== "string" ||
    typeof session.name !== "string" ||
    typeof session.email !== "string" ||
    !isRole(session.role) ||
    (session.memberId !== null && typeof session.memberId !== "string")
  ) {
    return null;
  }
  const user = getUsers().find((item) => item.id === session.id);
  if (!user) {
    logoutPrototype();
    return null;
  }
  return publicUser(user);
}

export async function getPrototypeLibrary(): Promise<LibraryState> {
  await initializePrototype();
  return normalizeLibraryState(readJson<LibraryState>(LIBRARY_KEY, initialLibraryState));
}

export async function loginPrototype(
  email: string,
  password: string,
): Promise<PrototypeUser> {
  await initializePrototype();
  const user = getUsers().find(
    (item) => item.email === email.trim().toLowerCase(),
  );
  if (!user || !user.active) throw new Error("Email or password is incorrect.");

  const digest = await passwordDigest(password, fromHex(user.passwordSalt));
  if (digest !== user.passwordHash) {
    throw new Error("Email or password is incorrect.");
  }

  const session = publicUser(user);
  writeJson(SESSION_KEY, session);
  return session;
}

export async function requestPrototypePasswordReset(email: string): Promise<string | null> {
  await initializePrototype();
  const user = getUsers().find((item) => item.email === email.trim().toLowerCase() && item.active);
  if (!user) return null;
  const token = window.crypto.randomUUID() + window.crypto.randomUUID();
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  writeJson(RESET_KEY, {
    userId: user.id,
    tokenHash: toHex(new Uint8Array(digest)),
    expiresAt: Date.now() + 30 * 60_000,
  });
  return token;
}

export async function completePrototypePasswordReset(
  token: string,
  password: string,
  confirmPassword: string,
): Promise<void> {
  const checked = passwordSchema.safeParse(password);
  if (!checked.success) throw new Error(checked.error.issues[0]?.message ?? "Choose a stronger password.");
  if (password !== confirmPassword) throw new Error("Passwords do not match.");
  const reset = readJson<{ userId: string; tokenHash: string; expiresAt: number } | null>(RESET_KEY, null);
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  if (
    !reset ||
    reset.expiresAt <= Date.now() ||
    reset.tokenHash !== toHex(new Uint8Array(digest))
  ) {
    throw new Error("This local reset code is invalid or expired. Request a new one.");
  }
  const users = getUsers();
  const user = users.find((item) => item.id === reset.userId);
  if (!user) throw new Error("Prototype account not found.");
  const salt = new ArrayBuffer(16);
  window.crypto.getRandomValues(new Uint8Array(salt));
  user.passwordSalt = toHex(new Uint8Array(salt));
  user.passwordHash = await passwordDigest(password, salt);
  writeJson(USERS_KEY, users);
  window.localStorage.removeItem(RESET_KEY);
  logoutPrototype();
}

export async function registerPrototype(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}): Promise<PrototypeUser> {
  await initializePrototype();
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Check the registration details.",
    );
  }

  const email = parsed.data.email.toLowerCase();
  const users = getUsers();
  if (users.some((user) => user.email === email)) {
    throw new Error("An account with this email address already exists.");
  }

  const state = await getPrototypeLibrary();
  const existingMember = state.members.find((member) => member.email.toLowerCase() === email);
  const memberId = existingMember?.id ?? `m-${window.crypto.randomUUID()}`;
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
  writeJson(LIBRARY_KEY, {
    ...state,
    members: existingMember
      ? state.members.map((item) => item.id === existingMember.id ? member : item)
      : [...state.members, member],
  });

  const user = await createStoredUser(
    {
      id: `prototype-user-${window.crypto.randomUUID()}`,
      name: parsed.data.name,
      email,
      phone: parsed.data.phone,
      role: "Customer",
      memberId,
    },
    parsed.data.password,
  );
  writeJson(USERS_KEY, [...users, user]);
  const session = publicUser(user);
  writeJson(SESSION_KEY, session);
  return session;
}

export function logoutPrototype(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

export function getPrototypeStaff(): PrototypeStaff[] {
  return getUsers()
    .filter((user): user is StoredUser & { role: Exclude<Role, "Customer"> } => user.role !== "Customer")
    .map(({ id, name, email, phone, role, active, permissions, createdAt }) => ({
      id,
      name,
      email,
      phone,
      role,
      active,
      permissions,
      createdAt,
    }));
}

function appendPrototypeStaffAudit(
  actor: string,
  action: string,
  item: string,
  before?: string,
  after?: string,
): void {
  const state = normalizeLibraryState(readJson<LibraryState>(LIBRARY_KEY, initialLibraryState));
  writeJson(LIBRARY_KEY, {
    ...state,
    auditLog: [{
      id: `AUD-${window.crypto.randomUUID()}`,
      actor,
      action,
      item,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      createdAt: new Date().toISOString(),
    }, ...(state.auditLog ?? [])],
  });
}

export async function createPrototypeStaff(input: {
  name: string;
  email: string;
  phone: string;
  role: Exclude<Role, "Customer">;
  password: string;
}): Promise<void> {
  const users = getUsers();
  const email = input.email.trim().toLowerCase();
  if (users.some((user) => user.email === email)) {
    throw new Error("An account with this email already exists.");
  }
  const parsed = registerSchema.safeParse({
    ...input,
    email,
    confirmPassword: input.password,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Check the staff details.");
  }
  const staff = await createStoredUser(
    {
      id: `prototype-staff-${window.crypto.randomUUID()}`,
      name: parsed.data.name,
      email,
      phone: parsed.data.phone,
      role: input.role,
      memberId: null,
    },
    input.password,
  );
  writeJson(USERS_KEY, [...users, staff]);
  const actor = (await getPrototypeSession())?.name ?? "Manager";
  appendPrototypeStaffAudit(actor, "Created staff account", staff.email, undefined, JSON.stringify({ role: staff.role, active: staff.active }));
}

export async function updatePrototypeStaff(input: {
  userId: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: Exclude<Role, "Customer">;
  active?: boolean;
  permissions?: Record<string, boolean>;
  password?: string;
}): Promise<void> {
  const users = getUsers();
  const index = users.findIndex(
    (user) => user.id === input.userId && user.role !== "Customer",
  );
  if (index < 0) throw new Error("Staff account not found.");
  const current = users[index]!;
  const email = input.email?.trim().toLowerCase();
  if (
    email &&
    users.some((user, userIndex) => user.email === email && userIndex !== index)
  ) {
    throw new Error("Another account already uses this email address.");
  }
  const updated: StoredUser = {
    ...current,
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(email === undefined ? {} : { email }),
    ...(input.phone === undefined ? {} : { phone: input.phone.trim() }),
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.active === undefined ? {} : { active: input.active }),
    ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
  };
  if (input.password) {
    if (input.password.length < 12) {
      throw new Error("Use at least 12 characters for the password.");
    }
    const salt = new ArrayBuffer(16);
    window.crypto.getRandomValues(new Uint8Array(salt));
    updated.passwordSalt = toHex(new Uint8Array(salt));
    updated.passwordHash = await passwordDigest(input.password, salt);
  }
  users[index] = updated;
  writeJson(USERS_KEY, users);
  const actor = (await getPrototypeSession())?.name ?? "Manager";
  appendPrototypeStaffAudit(
    actor,
    "Updated staff account",
    updated.email,
    JSON.stringify({ name: current.name, email: current.email, phone: current.phone, role: current.role, active: current.active, permissions: current.permissions }),
    JSON.stringify({ name: updated.name, email: updated.email, phone: updated.phone, role: updated.role, active: updated.active, permissions: updated.permissions, passwordChanged: input.password !== undefined }),
  );
}

export async function performPrototypeAction(
  action: LibraryAction,
  role: Role,
  memberId: string | null,
  actorName: string = role,
): Promise<LibraryState> {
  const state = await getPrototypeLibrary();
  const user = getUsers().find((item) => item.name === actorName);
  const permissionKey = ({
    saveBook: "catalog", deleteBook: "catalog", restoreBook: "catalog", addCategory: "catalog",
    reserve: "reservations", cancelReservation: "reservations",
    requestBorrow: "loans", approveRequest: "loans", rejectRequest: "loans",
    returnLoan: "loans", checkoutLoan: "loans", requestRenewal: "loans", decideRenewal: "loans",
    createSale: "sales", updateOrder: "sales", collectFinePayment: "fines", adjustFine: "fines",
    adjustStock: "inventory", recordStockLoss: "inventory", transferStock: "inventory", softDeleteMovement: "inventory", restoreMovement: "inventory",
    saveSupplier: "purchasing", createPurchaseOrder: "purchasing",
    decidePurchaseOrder: "purchasing", receivePurchaseOrder: "purchasing",
    addReview: "reviews", deleteReview: "reviews", updateSettings: "settings",
    approveMembership: "memberships", saveMember: "memberships", markNoticeRead: "notifications",
    markAllRead: "notifications", updateProfile: "profile",
  } as const)[action.type];
  if (role !== "Manager" && permissionKey && user?.permissions[permissionKey] === false) {
    throw new Error("This staff account does not have permission to perform this action.");
  }

  const next = executeLibraryAction(state, action, role, memberId, actorName);
  if (action.type === "updateProfile") {
    const users = getUsers();
    const userIndex = users.findIndex((user) => user.memberId === memberId || user.name === actorName);
    if (userIndex < 0) throw new Error("Your account could not be found.");
    if (users.some((user) => user.email === action.email.trim().toLowerCase() && userIndex !== users.indexOf(user))) {
      throw new Error("Another account already uses this email address.");
    }
    users[userIndex] = {
      ...users[userIndex]!,
      name: action.name.trim(),
      email: action.email.trim().toLowerCase(),
      phone: action.phone.trim(),
    };
    writeJson(USERS_KEY, users);
    writeJson(SESSION_KEY, publicUser(users[userIndex]!));
  }
  writeJson(LIBRARY_KEY, next);
  return next;
}

export async function restorePrototypeLibrary(input: unknown): Promise<LibraryState> {
  if (typeof input !== "object" || input === null || !("version" in input) || input.version !== 1 || !("state" in input)) {
    throw new Error("The selected file is not a valid Shelf & Soul backup.");
  }
  const raw = input.state;
  if (typeof raw !== "object" || raw === null ||
    !("books" in raw) || !Array.isArray(raw.books) ||
    !("members" in raw) || !Array.isArray(raw.members) ||
    !("loans" in raw) || !Array.isArray(raw.loans) ||
    !("requests" in raw) || !Array.isArray(raw.requests) ||
    !("reservations" in raw) || !Array.isArray(raw.reservations) ||
    !("movements" in raw) || !Array.isArray(raw.movements) ||
    !("notices" in raw) || !Array.isArray(raw.notices)) {
    throw new Error("The selected backup is missing required library records.");
  }
  const state = normalizeLibraryState(raw as LibraryState);
  state.auditLog = [{
    id: `AUD-${crypto.randomUUID()}`,
    actor: "Prototype manager",
    action: "Restored library backup",
    item: "Library snapshot",
    createdAt: new Date().toISOString(),
  }, ...(state.auditLog ?? [])];
  writeJson(LIBRARY_KEY, state);
  return state;
}
