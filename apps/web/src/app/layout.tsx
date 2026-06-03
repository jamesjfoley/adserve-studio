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
      <html lang="en" suppressHydrationWarning>
        <head>
          {/* WS5 no-flash: set the nav-pinned state on the document element
              BEFORE paint so the CSS-driven sidebar width matches the stored
              value on first paint (no FOUC). Inlined as a string literal —
              never imported into an RSC. Storage access is wrapped so blocked
              storage degrades to the pinned default. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function () {
  try {
    var v = localStorage.getItem('adserve:nav:pinned');
    document.documentElement.dataset.navPinned = v === null ? 'true' : v;
  } catch (e) {
    document.documentElement.dataset.navPinned = 'true';
  }
})();`,
            }}
          />
        </head>
        <body className="min-h-screen antialiased">
          <PermissionsProvider>{children}</PermissionsProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
