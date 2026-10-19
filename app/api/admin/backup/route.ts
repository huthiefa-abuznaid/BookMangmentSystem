import { Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveUser } from "@/lib/api-auth";
import { normalizeLibraryState } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import type { AuditEntry, LibraryState } from "@/lib/types";

export const runtime = "nodejs";

const backupSchema = z.object({
  version: z.literal(1),
  state: z.object({
    books: z.array(z.unknown()),
    members: z.array(z.unknown()),
    loans: z.array(z.unknown()),
    requests: z.array(z.unknown()),
    reservations: z.array(z.unknown()),
    movements: z.array(z.unknown()),
    notices: z.array(z.unknown()),
  }).passthrough(),
});

async function managerRequired() {
  const user = await getActiveUser();
  return user?.role === UserRole.Manager ? user : null;
}

export async function GET() {
  try {
    const manager = await managerRequired();
    if (!manager) return NextResponse.json({ error: "Manager access is required." }, { status: 403 });
    const snapshot = await prisma.librarySnapshot.findUnique({ where: { id: "primary" }, select: { state: true, revision: true } });
    if (!snapshot) return NextResponse.json({ error: "The library database is not initialized." }, { status: 503 });
    return NextResponse.json({
      version: 1,
      createdAt: new Date().toISOString(),
      revision: snapshot.revision,
      state: snapshot.state,
    }, {
      headers: { "Content-Disposition": `attachment; filename="shelf-and-soul-backup-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  } catch (error) {
    console.error("Unable to create library backup:", error);
    return NextResponse.json({ error: "Could not create a library backup." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const manager = await managerRequired();
    if (!manager) return NextResponse.json({ error: "Manager access is required." }, { status: 403 });
    const body = await request.json() as { confirmation?: unknown; backup?: unknown };
    if (body.confirmation !== "RESTORE_LIBRARY_DATA") {
      return NextResponse.json({ error: "Explicit restore confirmation is required." }, { status: 400 });
    }
    const parsed = backupSchema.safeParse(body.backup);
    if (!parsed.success) return NextResponse.json({ error: "The selected file is not a valid Shelf & Soul backup." }, { status: 400 });
    const restored = normalizeLibraryState(parsed.data.state as unknown as LibraryState);
    const snapshot = await prisma.librarySnapshot.findUnique({ where: { id: "primary" }, select: { revision: true } });
    if (!snapshot) return NextResponse.json({ error: "The library database is not initialized." }, { status: 503 });
    const entry: AuditEntry = {
      id: `AUD-${crypto.randomUUID()}`,
      actor: manager.name,
      action: "Restored library backup",
      item: "Library snapshot",
      after: `Imported ${restored.books.length} books and ${restored.members.length} member records`,
      createdAt: new Date().toISOString(),
    };
    const state: LibraryState = { ...restored, auditLog: [entry, ...(restored.auditLog ?? [])] };
    const result = await prisma.librarySnapshot.updateMany({
      where: { id: "primary", revision: snapshot.revision },
      data: { revision: { increment: 1 }, state: state as unknown as Prisma.InputJsonValue },
    });
    if (result.count !== 1) return NextResponse.json({ error: "Library data changed during restore. Reload and retry." }, { status: 409 });
    return NextResponse.json({ message: "Library data restored. User accounts and passwords were not changed." });
  } catch (error) {
    console.error("Unable to restore library backup:", error);
    return NextResponse.json({ error: "Could not restore the selected library backup." }, { status: 500 });
  }
}
