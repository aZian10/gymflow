import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./lib/auth";

// Public route prefixes that do not require an active tenant session
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/api/auth/login",
  "/api/auth/register",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Allow public static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/public") ||
    pathname.includes(".") // static files like favicon.ico, images
  ) {
    return NextResponse.next();
  }

  // 2. Check if the current path is explicitly public
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path);

  // 3. Extract and verify session token from HttpOnly cookie
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySessionToken(sessionCookie) : null;

  // 4. Redirect logged-in users away from auth pages to their dashboard
  if (session && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // 5. If path is public and no auth is required, proceed
  if (isPublicPath) {
    return NextResponse.next();
  }

  // 6. Enforce authentication on all protected routes (/dashboard/*, /api/tenant/*, etc.)
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required. Active session cookie missing or expired." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 7. Inject validated tenant identity into request headers for downstream server components and handlers
  // CRITICAL: The tenant identity is DERIVED from the cryptographic session, NEVER trusted from query params!
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-tenant-id", session.tenantId);
  requestHeaders.set("x-tenant-schema", session.schemaName);
  requestHeaders.set("x-tenant-slug", session.tenantSlug);
  requestHeaders.set("x-user-id", session.userId);
  requestHeaders.set("x-user-role", session.role);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static files (_next/static, _next/image, favicon.ico)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
