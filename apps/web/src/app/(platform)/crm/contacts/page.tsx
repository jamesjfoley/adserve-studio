export default function ContactsPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Manage your contacts and leads
          </p>
        </div>
        <button className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
          Add contact
        </button>
      </div>

      {/* Empty state — shown when no records exist */}
      <div className="mt-16 flex flex-col items-center justify-center text-center">
        <div className="rounded-full bg-[var(--muted)] p-4">
          <svg
            className="h-8 w-8 text-[var(--muted-foreground)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
            />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-medium">No contacts yet</h3>
        <p className="mt-2 max-w-sm text-sm text-[var(--muted-foreground)]">
          Add your first contact to get started. You can also import contacts
          from a CSV file or let AI help build your contact database.
        </p>
      </div>
    </div>
  );
}
