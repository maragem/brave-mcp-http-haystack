FROM node:20-slim

WORKDIR /app

# Install the official Brave MCP server package and its dependencies.
# Only copy package.json first so Docker layer caching works — npm install
# only re-runs when dependencies change, not on every code edit.
COPY package.json .
RUN npm install --omit=dev

# Copy the auth proxy and start script
COPY proxy.mjs .
COPY start.sh .
RUN chmod +x start.sh

# Railway injects $PORT at runtime (typically 8080).
# EXPOSE is documentation-only — the actual port is read from $PORT.
EXPOSE 8080

CMD ["sh", "start.sh"]
