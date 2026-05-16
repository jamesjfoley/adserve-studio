import { auth } from "@clerk/nextjs/server";

export default async function DashboardPage() {
  const { userId, orgId } = await auth();

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-2 text-[var(--muted-foreground)]">
        Welcome to AdServe Studio. Your AI-first advertising operations platform.
      </p>

      {/* Placeholder cards — will be replaced with real data */}
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Contacts", value: "—", description: "Total contacts" },
          { label: "Companies", value: "—", description: "Active accounts" },
          { label: "Open deals", value: "—", description: "In pipeline" },
          { label: "Pipeline value", value: "—", description: "Total value" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6"
          >
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              {card.label}
            </p>
            <p className="mt-2 text-3xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      {/* Debug info — remove in production */}
      {process.env.NODE_ENV === "development" && (
        <div className="mt-12 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-xs font-mono">
          <p className="font-medium mb-2">Development info</p>
          <p>Clerk user ID: {userId}</p>
          <p>Clerk org ID: {orgId ?? "none (select an organisation)"}</p>
        </div>
      )}
    </div>
  );
}
