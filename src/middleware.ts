import { NextResponse, type NextRequest } from "next/server";

import { AUTH_SESSION_COOKIE } from "@/lib/auth-cookies";

/**
 * The gate in front of the admin area.
 *
 * This is a presence check and nothing more. Middleware runs on the edge
 * runtime, where there is no node:crypto to verify the legacy HMAC and no
 * database to look a session up in, so it cannot tell a real cookie from a
 * forged one. It exists to bounce anonymous visitors to the login screen
 * cheaply.
 *
 * The real check is getCurrentAdmin(), which every admin page and API route
 * calls, and which does verify. Nothing is authorised on the strength of this
 * file alone. Deleting it would cost a redirect, not a security boundary.
 */

/*
 * Better Auth prefixes the cookie with __Secure- whenever the base URL is
 * https, which is every deployed environment, and leaves it bare on http
 * localhost. Both spellings are checked, because matching only the bare name
 * would let production redirect a signed in admin straight back to the login
 * screen.
 */
const SESSION_COOKIES = [
  AUTH_SESSION_COOKIE,
  `__Secure-${AUTH_SESSION_COOKIE}`,
];

/**
 * Paths inside the guarded prefixes that have to stay reachable while signed
 * out. The password stage and first run setup both have to answer before there
 * is a session, and both do their own gating.
 */
const PUBLIC_ADMIN_PATHS = [
  "/admin/login",
  "/admin/setup",
  "/api/admin/login",
  "/api/admin/setup",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function hasSomeSession(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => request.cookies.get(name)?.value);
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname) || hasSomeSession(request)) {
    return NextResponse.next();
  }

  /*
   * An API call gets 401 and not a redirect. The pledge table approves with
   * fetch(), and a 307 to an HTML login page would arrive at that call as an
   * opaque success it cannot read. The shape matches src/lib/api.ts so the
   * client handles it like every other failure.
   */
  if (pathname.startsWith("/api/admin/")) {
    return new NextResponse(
      JSON.stringify({
        code: "unauthorized",
        title: "Sign in to continue.",
        status: 401,
      }),
      { status: 401, headers: { "content-type": "application/problem+json" } },
    );
  }

  const login = new URL("/admin/login", request.url);
  // Carries where they were headed, so the login screen can send them back.
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
