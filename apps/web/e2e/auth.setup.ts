import { test as setup, expect } from "@playwright/test";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import path from "node:path";

const authFile = path.resolve(__dirname, ".auth/user.json");

// Authenticated nav lives behind Clerk's auth.protect() middleware. We sign in
// ONCE here via @clerk/testing (no public route, middleware untouched) and save
// the session for the nav specs to reuse via storageState.
//
// Uses ticket-based sign-in (Clerk mints a sign-in token via the backend API
// from CLERK_SECRET_KEY) — more robust headless than driving password
// first-factor, and needs only the user's email identifier.
setup("authenticate", async ({ page }) => {
  const identifier = process.env.E2E_CLERK_USER_USERNAME;
  if (!identifier) {
    throw new Error(
      "E2E_CLERK_USER_USERNAME must be set (a Clerk user with a selected org) to run the nav e2e."
    );
  }

  // Obtain the Testing Token IN THIS worker process (clerkSetup writes it to
  // process.env.CLERK_TESTING_TOKEN, which a globalSetup run in the main process
  // would not propagate here) so setupClerkTestingToken can apply it.
  await clerkSetup({
    publishableKey:
      process.env.CLERK_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: identifier });

  // Confirm the session is live by reaching the protected (platform) shell
  // before saving state — fails loudly here if auth did not actually take.
  await page.goto("/dashboard");
  await expect(page.locator(".primary-nav-dock")).toBeVisible();

  await page.context().storageState({ path: authFile });
});
