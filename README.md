# Brave Search MCP Server — API Key Protected

A Railway-ready deployment of the [official Brave Search MCP Server](https://github.com/brave/brave-search-mcp-server) (`@brave/brave-search-mcp-server`) with **Bearer token authentication** — all clients must present a valid API key to connect.

> **Two separate API keys are involved:**
> - `BRAVE_API_KEY` — your Brave Search API key, used by the server to call the Brave Search API
> - `MCP_API_KEY` — a Bearer token *you* generate, used to protect access to *this MCP server*

---

## Architecture

```
Internet
  └── proxy.mjs  (Bearer auth + /health endpoint)  :$PORT
        └── @brave/brave-search-mcp-server          :$BRAVE_PORT (127.0.0.1 only)
```

The official Brave MCP server runs on an internal port (`127.0.0.1:3100`) — not reachable from outside the container. `proxy.mjs` sits in front of it on the public port, checks the `Authorization: Bearer` header, and pipes valid requests through with full SSE streaming support.

---

## Tools

All 6 tools from the official Brave MCP server are available:

| Tool | Description |
|---|---|
| `brave_web_search` | General web search with rich results, filtering, and pagination |
| `brave_local_search` | Local businesses, restaurants, and places with ratings and hours |
| `brave_video_search` | Video search with metadata and thumbnails |
| `brave_image_search` | Image search (returns URLs, not base64 since v2) |
| `brave_news_search` | News articles with freshness controls |
| `brave_summarizer` | AI-powered summary from web search results (requires Pro plan) |

---

## Prerequisites

You need a **Brave Search API key**. Get one at [brave.com/search/api](https://brave.com/search/api/).

- **Free plan:** 2,000 queries/month — covers `brave_web_search` and `brave_news_search`
- **Pro plan:** adds `brave_local_search`, `brave_summarizer`, extra snippets

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BRAVE_API_KEY` | **Yes** | Your Brave Search API key from the Brave developer dashboard |
| `MCP_API_KEY` | **Required in production** | Bearer token you generate to protect this server |
| `PORT` | Set by Railway automatically | Public port the auth proxy listens on |
| `BRAVE_PORT` | Optional | Internal port for the Brave server (default: `3100`) |

### Generating `MCP_API_KEY`

```bash
node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('base64url'))"
# or
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

---

## Deploy to Railway

1. Push this folder to a GitHub repository.
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
3. Select your repo — Railway detects the `Dockerfile` automatically.
4. Go to your service → **Variables** tab and add:
   - `BRAVE_API_KEY` = your Brave Search API key
   - `MCP_API_KEY` = your generated Bearer token
5. Go to **Settings → Networking → Generate Domain** to get your public URL.
6. Your server is live at `https://your-domain.up.railway.app/mcp`.

> The build takes ~1 minute (Node 20 slim + npm install of the Brave package).

---

## Verify the Deployment

```bash
# Health check — always public, no token needed
curl https://YOUR-DOMAIN.up.railway.app/health

# Without token → 401
curl -I https://YOUR-DOMAIN.up.railway.app/mcp

# With token → 200
curl -I https://YOUR-DOMAIN.up.railway.app/mcp \
  -H "Authorization: Bearer YOUR-MCP-API-KEY"

# Explore tools in the MCP Inspector
npx @modelcontextprotocol/inspector https://YOUR-DOMAIN.up.railway.app/mcp \
  --header "Authorization: Bearer YOUR-MCP-API-KEY"
```

---

## Connect to Claude Desktop

Add this to your `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://YOUR-DOMAIN.up.railway.app/mcp",
        "--header",
        "Authorization: Bearer YOUR-MCP-API-KEY"
      ]
    }
  }
}
```

---

## Connect to Haystack Enterprise Platform

Add this `MCPToolset` block to your Agent pipeline YAML:

```yaml
- type: haystack_integrations.tools.mcp.MCPToolset
  data:
    server_info:
      type: haystack_integrations.tools.mcp.mcp_tool.StreamableHttpServerInfo
      url: https://YOUR-DOMAIN.up.railway.app/mcp
      timeout: 60
      token:
        type: env_var
        strict: true
        env_vars:
        - MCP_API_KEY
    tool_names:
    - brave_web_search
    - brave_news_search
    - brave_local_search
    - brave_video_search
    - brave_image_search
    - brave_summarizer
    eager_connect: false
```

In Haystack Enterprise Platform → **Settings → Secrets**, add `MCP_API_KEY` with the same token value set in Railway. The `type: env_var` block reads it at runtime — the token never appears in the YAML.

> **Note:** `brave_summarizer` requires a Brave Pro plan API key. If you are on the Free plan, remove it from `tool_names` to avoid errors.

---

## Security

- The auth proxy (`proxy.mjs`) is pure Node.js with no dependencies beyond the built-in `http` and `crypto` modules.
- Token comparison uses `crypto.timingSafeEqual()` to prevent timing attacks.
- The Brave MCP server binds to `127.0.0.1` only — it is not reachable from outside the container.
- `/health` is always public so Railway health checks work without credentials.
- If `MCP_API_KEY` is not set, the proxy allows all traffic and logs a warning — useful for local development, never for production.

---

## Project Structure

```
brave-mcp-http/
├── proxy.mjs        # Bearer auth proxy (pure Node.js, no extra deps)
├── start.sh         # Starts Brave MCP server + proxy
├── package.json     # npm deps (@brave/brave-search-mcp-server)
├── Dockerfile       # Node 20 slim container
├── railway.json     # Railway config-as-code
├── README.md        # This file
└── .gitignore
```

---

## Local Development

```bash
npm install

# Set your keys
export BRAVE_API_KEY="your-brave-api-key"
export MCP_API_KEY="your-test-token"   # optional locally

# Start both processes
sh start.sh
```

The server will be available at `http://localhost:8080/mcp`.

---

## License

MIT — this deployment wrapper is free to use, modify, and distribute.  
The Brave Search MCP Server itself is also MIT licensed by Brave Software.
