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
          {process.env.NEXT_PUBLIC_PROTOTYPE === "true" && (
            <div
              role="note"
              aria-label="Prototype environment notice"
              style={{
                position: "sticky",
                top: 0,
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                width: "100%",
                padding: "4px 12px",
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "#451a03",
                background:
                  "repeating-linear-gradient(45deg,#fbbf24,#fbbf24 12px,#f59e0b 12px,#f59e0b 24px)",
                borderBottom: "1px solid #b45309",
              }}
            >
              Prototype — not production · dummy data · do not enter real
              customer information
            </div>
          )}
          <PermissionsProvider>{children}</PermissionsProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
