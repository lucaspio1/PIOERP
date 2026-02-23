# =============================================================================
# PIOERP — Dockerfile
# Build context: projeto raiz (.) para incluir backend/ e frontend/
# =============================================================================
FROM node:20-alpine

# Metadados
LABEL org.opencontainers.image.title="PIOERP"
LABEL org.opencontainers.image.description="Gestão de Estoque de Equipamentos de T.I."

WORKDIR /app

# ── Dependências (camada separada para cache eficiente) ───────────────────────
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Código do backend ─────────────────────────────────────────────────────────
COPY backend/src ./src

# ── Frontend (arquivos estáticos servidos pelo Express) ───────────────────────
# Copiado para /app/frontend — mapeado via FRONTEND_PATH no docker-compose
COPY frontend ./frontend

# ── Configurações padrão ──────────────────────────────────────────────────────
ENV NODE_ENV=production \
    PORT=3000 \
    FRONTEND_PATH=/app/frontend

EXPOSE 3000

# Healthcheck interno do container
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/app.js"]
