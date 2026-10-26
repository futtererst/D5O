import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isProductionRouteAvailable } from "./lib/d5o/security/production-module-availability";
import { d5oSupabaseCookieOptions } from "./lib/d5o/auth/supabase-cookie-options";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

const SIGN_IN_PATH = "/auth/sign-in";
const SIGN_OUT_PATH = "/auth/sign-out";

export async function proxy(request: NextRequest) {
  if (process.env.RYBEXOS_RUNTIME_MODE !== "production") {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;

  if (isPublicAsset(pathname) || isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // The selected hosted D5O project shares an Auth service with an older Rybex
  // application. Hosted mode exposes only isolated D5O API routes; it must not
  // make legacy production modules available through the same credentials.
  const hostedD5O = process.env.D5O_HOSTED_ENABLED === "1";
  if (hostedD5O && pathname === "/") {
    return NextResponse.redirect(new URL("/work", request.url));
  }
  if (hostedD5O && pathname !== "/work" && pathname !== "/work/procurement" && pathname !== "/work/labor" && pathname !== "/work/my-schedule"
    && (pathname !== "/work/admin" && !pathname.startsWith("/work/admin/"))
    && (pathname !== "/platform-admin" && !pathname.startsWith("/platform-admin/"))
    && !pathname.startsWith("/work/my-schedule/") && !pathname.startsWith("/api/d5o-hosted/")) {
    return new NextResponse("The hosted D5O work surface is not yet available.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  if (!hostedD5O && !isProductionRouteAvailable(pathname) && !isProtectedAuthDiagnostic(pathname)) {
    return new NextResponse(
      "This RybexOS module is unavailable in production mode until it passes an approved production persistence gate.",
      {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-rybexos-module-availability": "unavailable_until_migrated",
          "cache-control": "no-store"
        }
      }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return unauthenticatedResponse(request);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: d5oSupabaseCookieOptions(supabaseUrl),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        response.headers.set("cache-control", "no-store");
      }
    }
  });

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return unauthenticatedResponse(request);
  }

  response.headers.set("x-rybexos-auth-bridge", "supabase-ssr");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};

function unauthenticatedResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { success: false, error: "unauthenticated" },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = SIGN_IN_PATH;
  redirectUrl.search = `?next=${encodeURIComponent(safeNextPath(request))}`;
  const response = NextResponse.redirect(redirectUrl);
  response.headers.set("cache-control", "no-store");
  return response;
}

function safeNextPath(request: NextRequest) {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`.startsWith("//")
    ? "/command-center"
    : `${request.nextUrl.pathname}${request.nextUrl.search}`;
}

function isPublicRoute(pathname: string) {
  return (
    pathname === SIGN_IN_PATH ||
    pathname.startsWith(`${SIGN_IN_PATH}/`) ||
    pathname === SIGN_OUT_PATH ||
    pathname.startsWith(`${SIGN_OUT_PATH}/`) ||
    pathname === "/auth/set-password" ||
    pathname === "/auth/create-account" ||
    pathname === "/auth/confirm" ||
    pathname === "/auth/forgot-password" ||
    pathname === "/api/auth/password-recovery" ||
    pathname === "/api/health" ||
    pathname === "/api/readiness"
  );
}

function isProtectedAuthDiagnostic(pathname: string) {
  return pathname === "/api/auth/session-proof";
}

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  );
}
