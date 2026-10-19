import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shelf & Soul | Library management",
  description: "A thoughtful library and bookshop management workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
