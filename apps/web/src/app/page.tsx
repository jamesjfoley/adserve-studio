import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function HomePage() {
  const { userId } = await auth();

  // If already signed in, go straight to dashboard
  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          AdServe Studio
        </h1>
        <p className="mt-4 text-lg text-[var(--muted-foreground)]">
          Next-generation advertising operations platform.
          AI-first. Fully customisable. Built for media.
        </p>
        <div className="mt-8 flex gap-4 justify-center">
          <Link
            href="/sign-in"
            className="rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg border border-[var(--border)] px-6 py-2.5 text-sm font-medium hover:bg-[var(--muted)] transition-colors"
          >
            Get started
          </Link>
        </div>
      </div>
    </div>
  );
}
