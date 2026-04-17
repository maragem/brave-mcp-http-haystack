#!/bin/sh
# start.sh — start Brave MCP server on internal port, then the auth proxy on the public port

BRAVE_PORT=${BRAVE_PORT:-3100}

echo "[start] Starting Brave MCP server on internal port $BRAVE_PORT ..."

# Resolve the Brave server entry point from the installed package
BRAVE_BIN=$(node -e "require.resolve('@brave/brave-search-mcp-server/dist/index.js')" 2>/dev/null)

if [ -z "$BRAVE_BIN" ]; then
  # Fallback: locate via node_modules
  BRAVE_BIN="/app/node_modules/@brave/brave-search-mcp-server/dist/index.js"
fi

echo "[start] Brave server entry: $BRAVE_BIN"

# Start Brave MCP in HTTP mode on internal port
BRAVE_MCP_TRANSPORT=http \
BRAVE_MCP_PORT=$BRAVE_PORT \
BRAVE_MCP_HOST=127.0.0.1 \
BRAVE_MCP_STATELESS=true \
BRAVE_API_KEY=$BRAVE_API_KEY \
node "$BRAVE_BIN" &

BRAVE_PID=$!
echo "[start] Brave MCP server PID: $BRAVE_PID"

# Wait until the Brave server is actually accepting connections before starting proxy
echo "[start] Waiting for Brave server to be ready on port $BRAVE_PORT ..."
RETRIES=30
while [ $RETRIES -gt 0 ]; do
  # Try a TCP connection to the internal port
  node -e "
    const net = require('net');
    const c = net.createConnection($BRAVE_PORT, '127.0.0.1');
    c.on('connect', () => { c.destroy(); process.exit(0); });
    c.on('error', () => { c.destroy(); process.exit(1); });
  " 2>/dev/null && break
  RETRIES=$((RETRIES - 1))
  sleep 1
done

if [ $RETRIES -eq 0 ]; then
  echo "[start] ERROR: Brave server did not start within 30 seconds"
  kill $BRAVE_PID 2>/dev/null
  exit 1
fi

echo "[start] Brave server is ready. Starting auth proxy on public port ${PORT:-8080} ..."
node /app/proxy.mjs &

PROXY_PID=$!
echo "[start] Auth proxy PID: $PROXY_PID"

# Monitor both processes — restart container if either dies
while true; do
  if ! kill -0 $BRAVE_PID 2>/dev/null; then
    echo "[start] Brave server died. Exiting."
    kill $PROXY_PID 2>/dev/null
    exit 1
  fi
  if ! kill -0 $PROXY_PID 2>/dev/null; then
    echo "[start] Proxy died. Exiting."
    kill $BRAVE_PID 2>/dev/null
    exit 1
  fi
  sleep 5
done
