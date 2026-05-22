import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
  "/api/webhooks(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Allow public routes through without auth
  if (isPublicRoute(req)) {
    return;
  }

  // Protect all other routes — redirects to sign-in if not authenticated
  await auth.protect();
});

export const config = {
  // Match all routes except static files and Next.js internals
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
