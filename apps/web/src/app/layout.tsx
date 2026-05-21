import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { PermissionsProvider } from "@/lib/permissions-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdServe Studio",
  description: "Next-generation advertising operations platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen antialiased">
          <PermissionsProvider>{children}</PermissionsProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
