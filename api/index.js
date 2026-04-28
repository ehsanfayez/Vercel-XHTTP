export const config = { runtime: "edge" };

function sanitizeEndpoint(rawEndpoint) {
  const candidate = (rawEndpoint || "").trim();
  if (!candidate) return "";

  // Accept "domain:port" style values and default to HTTPS.
  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const normalizedUrl = new URL(withProtocol);
    // Normalize trailing slashes to avoid accidental double slashes on join.
    normalizedUrl.pathname = normalizedUrl.pathname.replace(/\/+$/, "");
    normalizedUrl.search = "";
    normalizedUrl.hash = "";
    return normalizedUrl.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const UPSTREAM_ROOT = sanitizeEndpoint(process.env.UPSTREAM_HOST);

const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function edgeRelay(req) {
  if (!UPSTREAM_ROOT) {
    return new Response(
      "Misconfigured: UPSTREAM_HOST is missing or invalid. Use e.g. https://xray.example.com:2096",
      { status: 500 }
    );
  }

  try {
    const sourceUrl = new URL(req.url);
    const relayUrl = `${UPSTREAM_ROOT}${sourceUrl.pathname}${sourceUrl.search}`;

    const forwardedHeaders = new Headers();
    let requesterIp = null;
    for (const [headerName, headerValue] of req.headers) {
      if (HOP_BY_HOP_HEADERS.has(headerName)) continue;
      if (headerName.startsWith("x-vercel-")) continue;
      if (headerName === "x-real-ip") {
        requesterIp = headerValue;
        continue;
      }
      if (headerName === "x-forwarded-for") {
        if (!requesterIp) requesterIp = headerValue;
        continue;
      }
      forwardedHeaders.set(headerName, headerValue);
    }
    if (requesterIp) forwardedHeaders.set("x-forwarded-for", requesterIp);

    const httpMethod = req.method;
    const shouldProxyBody = httpMethod !== "GET" && httpMethod !== "HEAD";

    return await fetch(relayUrl, {
      method: httpMethod,
      headers: forwardedHeaders,
      body: shouldProxyBody ? req.body : undefined,
      redirect: "manual",
    });
  } catch (cause) {
    const errorText = cause instanceof Error ? cause.message : String(cause);
    console.error("relay error:", errorText);
    return new Response(`Bad Gateway: Tunnel Failed (${errorText})`, {
      status: 502,
    });
  }
}