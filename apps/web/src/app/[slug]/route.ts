import {NextRequest} from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

export async function GET(
  request: NextRequest,
  context: {params: Promise<{slug: string}>}
) {
  if (!API_BASE) {
    return new Response("Short-link service is not configured.", {
      status: 503,
      headers: {"Cache-Control": "no-store"}
    });
  }

  const {slug} = await context.params;
  if (!/^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])?$/i.test(slug)) {
    return new Response("Link not found.", {status: 404});
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      new URL("/v1/redirect/" + encodeURIComponent(slug), API_BASE),
      {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: {
          "x-forwarded-host": request.headers.get("host") ?? "",
          "x-forwarded-proto": request.headers.get("x-forwarded-proto") ?? "https"
        }
      }
    );
  } catch {
    return new Response("Short-link service is temporarily unavailable.", {
      status: 503,
      headers: {"Cache-Control": "no-store", "Retry-After": "30"}
    });
  }

  if ([301, 302, 307, 308].includes(upstream.status)) {
    const location = upstream.headers.get("location");
    if (!location) return new Response("Invalid redirect response.", {status: 502});
    return Response.redirect(location, upstream.status);
  }

  if (upstream.status === 404) {
    return new Response("Link not found or expired.", {
      status: 404,
      headers: {"Cache-Control": "no-store"}
    });
  }

  return new Response("Short-link service is temporarily unavailable.", {
    status: 503,
    headers: {"Cache-Control": "no-store", "Retry-After": "30"}
  });
}
