export const config = { runtime: "edge" };

function normalizeTargetBase(rawTarget) {
  const raw = (rawTarget || "").trim();
  if (!raw) return "";

  // Accept "domain:port" style values and default to HTTPS.
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    // Normalize trailing slashes to avoid accidental double slashes on join.
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const TARGET_BASE = normalizeTargetBase(process.env.TARGET_DOMAIN);

const STRIP_HEADERS = new Set([
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

export default async function handler(req) {
  if (!TARGET_BASE) {
    return new Response(
      "Misconfigured: TARGET_DOMAIN is missing or invalid. Use e.g. https://xray.example.com:2096",
      { status: 500 }
    );
  }

  try {
    const incomingUrl = new URL(req.url);
    const targetUrl = `${TARGET_BASE}${incomingUrl.pathname}${incomingUrl.search}`;

    const out = new Headers();
    let clientIp = null;
    for (const [k, v] of req.headers) {
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip") {
        clientIp = v;
        continue;
      }
      if (k === "x-forwarded-for") {
        if (!clientIp) clientIp = v;
        continue;
      }
      out.set(k, v);
    }
    if (clientIp) out.set("x-forwarded-for", clientIp);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    return await fetch(targetUrl, {
      method,
      headers: out,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("relay error:", message);
    return new Response(`Bad Gateway: Tunnel Failed (${message})`, { status: 502 });
  }
}