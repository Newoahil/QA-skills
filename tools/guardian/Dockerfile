# QA Guardian — Feishu callback service (Dokploy / docker compose)
# Minimal Node runtime; the service uses only the Node standard library (http, crypto) + fetch.
FROM node:24-alpine

WORKDIR /app

# Only the guardian tool sources are needed at runtime (no package.json / deps).
COPY tools/guardian/ ./tools/guardian/

ENV PORT=8787 \
    CALLBACK_PATH=/feishu/callback \
    NODE_ENV=production

EXPOSE 8787

# Healthcheck hits the built-in /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8787) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "tools/guardian/callback-server.mjs"]
