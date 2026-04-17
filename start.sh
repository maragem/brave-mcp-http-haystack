#!/bin/sh
# start.sh — start Brave MCP server on internal port, then the auth proxy on the public port
#
# Railway sets $PORT automatically. The Brave MCP server runs on $BRAVE_PORT (internal,
# never exposed). The auth proxy (proxy.mjs) listens on $PORT and forwards to BRAVE_PORT.

set -e

BRAVE_PORT=${BRAVE_PORT:-3100}

echo "[start] Starting Brave MCP server on internal port $BRAVE_PORT ..."

# Start the official Brave MCP server in HTTP/streamable-http mode on the internal port.
# BRAVE_MCP_TRANSPORT=http enables HTTP mode (default is stdio).
# BRAVE_MCP_STATELESS=true required for stateless Railway deployments.
BRAVE_MCP_TRANSPORT=http \
BRAVE_MCP_PORT=$BRAVE_PORT \
BRAVE_MCP_HOST=127.0.0.1 \
BRAVE_MCP_STATELESS=true \
node /app/node_modules/@brave/brave-search-mcp-server/dist/index.js &

BRAVE_PID=$!
echo "[start] Brave MCP server PID: $BRAVE_PID"

# Give the Brave server a moment to bind its port before we start the proxy
sleep 2

echo "[start] Starting auth proxy on public port ${PORT:-8080} ..."
node /app/proxy.mjs &

PROXY_PID=$!
echo "[start] Auth proxy PID: $PROXY_PID"

# Wait for either process to exit — if one dies, the container should restart
wait -n $BRAVE_PID $PROXY_PID
EXIT_CODE=$?
echo "[start] A process exited with code $EXIT_CODE. Shutting down."
kill $BRAVE_PID $PROXY_PID 2>/dev/null || true
exit $EXIT_CODE
