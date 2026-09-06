import { routes } from "@/lib/routes";

/**
 * Full document navigation after a session is created.
 *
 * Client-side `router.push("/auth/callback")` keeps the React Query cache
 * from the logged-out sign-in page (`user: null`, isLoading false). The
 * callback then treats that as logged-out and bounces back to `/sign-in`
 * without re-running the server redirect — until a hard refresh.
 */
export function hardRedirectAfterAuth(path: string = routes.authCallback()) {
  window.location.assign(path);
}
