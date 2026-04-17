/**
 * proxy.mjs — Bearer auth proxy for the Brave Search MCP Server
 *
 * Architecture:
 *   Internet → proxy.mjs (Bearer auth check) → localhost:BRAVE_PORT (Brave MCP)
 *
 * The Brave MCP server (@brave/brave-search-mcp-server) runs on an internal port
 * with no authentication. This proxy sits in front of it, rejects requests without
 * a valid Bearer token, and forwards everything else unchanged — preserving SSE
 * streaming by piping the response directly without buffering.
 *
 * Environment variables:
 *   MCP_API_KEY    — Bearer token clients must send (required in production)
 *   PORT           — Public port this proxy listens on (injected by Railway, default 8080)
 *   BRAVE_PORT     — Internal port the Brave MCP server runs on (default 3100)
 */

import http from "http";
import { createServer } from "http";
import { request as httpRequest } from "http";
import crypto from "crypto";

const PUBLIC_PORT = parseInt(process.env.PORT ?? "8080", 10);
const BRAVE_PORT = parseInt(process.env.BRAVE_PORT ?? "3100", 10);
const API_KEY = process.env.MCP_API_KEY ?? "";

if (!API_KEY) {
  console.warn(
    "[proxy] WARNING: MCP_API_KEY is not set. " +
      "The proxy is running WITHOUT authentication. " +
      "Set MCP_API_KEY in Railway Variables before exposing to the internet."
  );
}

// ── Auth check ────────────────────────────────────────────────────────────────

function isAuthorised(req) {
  if (!API_KEY) return true; // dev mode — no key configured
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(API_KEY)
    );
  } catch {
    return false; // length mismatch throws — treat as invalid
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ── Proxy logic ───────────────────────────────────────────────────────────────

const proxy = createServer((req, res) => {
  // Health check — always public, no auth
  if (req.url === "/health" && req.method === "GET") {
    return sendJson(res, 200, {
      status: "healthy",
      service: "brave-search-mcp",
      auth: !!API_KEY,
    });
  }

  // Auth gate
  if (!isAuthorised(req)) {
    return sendJson(res, 401, {
      error: "Unauthorised. Use: Authorization: Bearer <your-token>",
    });
  }

  // Forward to Brave MCP server — pipe directly so SSE streaming is preserved
  const options = {
    hostname: "127.0.0.1",
    port: BRAVE_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${BRAVE_PORT}` },
  };

  const upstream = httpRequest(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res, { end: true });
  });

  upstream.on("error", (err) => {
    console.error("[proxy] upstream error:", err.message);
    if (!res.headersSent) {
      sendJson(res, 502, { error: "Upstream unavailable", detail: err.message });
    } else {
      res.end();
    }
  });

  req.pipe(upstream, { end: true });
});

proxy.listen(PUBLIC_PORT, "0.0.0.0", () => {
  console.log(`[proxy] Listening on 0.0.0.0:${PUBLIC_PORT}`);
  console.log(`[proxy] Forwarding to 127.0.0.1:${BRAVE_PORT}`);
  console.log(`[proxy] Auth: ${API_KEY ? "enabled" : "DISABLED (dev mode)"}`);
});
