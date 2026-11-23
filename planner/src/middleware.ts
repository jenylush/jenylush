import { NextResponse, type NextRequest } from "next/server";

/** Cheap edge check — the real session validation happens server-side in requireUser(). */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("ol_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*", "/onboarding/:path*"] };
