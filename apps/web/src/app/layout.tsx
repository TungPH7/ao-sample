import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ghi chú",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
