/**
 * proxy.mjs — Bearer auth proxy for the Brave Search MCP Server
 *
 * Architecture:
 *   Internet → proxy.mjs (Bearer auth check) → localhost:BRAVE_PORT (Brave MCP)
 *
 * Environment variables:
 *   MCP_API_KEY  — Bearer token clients must send (required in production)
 *   PORT         — Public port this proxy listens on (injected by Railway, default 8080)
 *   BRAVE_PORT   — Internal port the Brave MCP server runs on (default 3100)
 */

import { createServer, request as httpRequest } from "http";
import crypto from "crypto";

const PUBLIC_PORT = parseInt(process.env.PORT ?? "8080", 10);
const BRAVE_PORT  = parseInt(process.env.BRAVE_PORT ?? "3100", 10);
const API_KEY     = process.env.MCP_API_KEY ?? "";

if (!API_KEY) {
  console.warn(
    "[proxy] WARNING: MCP_API_KEY is not set. " +
    "Running WITHOUT authentication. Set MCP_API_KEY in Railway Variables."
  );
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthorised(req) {
  if (!API_KEY) return true;
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(API_KEY));
  } catch {
    return false; // length mismatch — reject
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

// ── Proxy with retry on ECONNREFUSED ─────────────────────────────────────────

function forwardRequest(req, res, retries = 5, delayMs = 1000) {
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
    if (err.code === "ECONNREFUSED" && retries > 0) {
      // Brave server not yet accepting — retry after delay
      console.warn(`[proxy] upstream ECONNREFUSED, retrying in ${delayMs}ms (${retries} left)`);
      setTimeout(() => {
        if (!res.headersSent) forwardRequest(req, res, retries - 1, delayMs * 1.5);
      }, delayMs);
    } else {
      console.error("[proxy] upstream error:", err.message);
      if (!res.headersSent) {
        sendJson(res, 502, { error: "Upstream unavailable", detail: err.message });
      } else {
        res.end();
      }
    }
  });

  req.pipe(upstream, { end: true });
}

// ── Server ────────────────────────────────────────────────────────────────────

const proxy = createServer((req, res) => {
  // Health — always public
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

  forwardRequest(req, res);
});

proxy.listen(PUBLIC_PORT, "0.0.0.0", () => {
  console.log(`[proxy] Listening on 0.0.0.0:${PUBLIC_PORT}`);
  console.log(`[proxy] Forwarding to 127.0.0.1:${BRAVE_PORT}`);
  console.log(`[proxy] Auth: ${API_KEY ? "enabled" : "DISABLED (dev mode)"}`);
});
