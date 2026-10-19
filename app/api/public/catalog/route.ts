import { NextResponse } from "next/server";
import { normalizeLibraryState } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import type { LibraryState } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const snapshot = await prisma.librarySnapshot.findUnique({
      where: { id: "primary" },
      select: { state: true },
    });
    if (!snapshot) {
      return NextResponse.json({
        books: [],
        contactDetails: { branchAddress: "", contactEmail: "", contactPhone: "", openingHours: "" },
      });
    }
    const state = normalizeLibraryState(snapshot.state as unknown as LibraryState);
    return NextResponse.json({
      contactDetails: {
        branchAddress: state.settings?.branchAddress ?? "",
        contactEmail: state.settings?.contactEmail ?? "",
        contactPhone: state.settings?.contactPhone ?? "",
        openingHours: state.settings?.openingHours ?? "",
      },
      books: state.books.filter((book) => !book.deletedAt).map((book) => {
        const borrowed = state.loans.filter(
          (loan) => loan.bookId === book.id && loan.status === "Active",
        ).length;
        const held = state.reservations.filter((reservation) =>
          reservation.bookId === book.id &&
          reservation.status === "Ready for pickup" &&
          (!reservation.holdUntil || Date.parse(reservation.holdUntil) > Date.now()),
        ).length;
        const quantity = Math.max(0, book.quantity - borrowed - (book.damagedQuantity ?? 0) - held);
        return {
          id: book.id,
          title: book.title,
          author: book.author,
          category: book.category,
          description: book.description,
          price: book.price,
          cover: book.cover,
          forSale: book.forSale,
          quantity,
          availability: quantity > 0 ? "Available" : held > 0 ? "Reserved" : "Out of stock",
        };
      }),
    });
  } catch (error) {
    console.error("Unable to load the public catalog:", error);
    return NextResponse.json(
      { error: "The public catalog is temporarily unavailable." },
      { status: 500 },
    );
  }
}
