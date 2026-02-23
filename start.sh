#!/usr/bin/env bash
# =============================================================================
# PIOERP — Script de inicialização (WSL / Linux)
# Uso: ./start.sh
# =============================================================================
set -euo pipefail

# ── Cores ─────────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

# ── Banner ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   PIOERP — Gestão de Estoque de T.I.    ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── Pré-requisitos ─────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo -e "${RED}✗ Docker não encontrado.${RESET}"
  echo ""
  echo "  Instale o Docker Desktop e habilite a integração WSL2:"
  echo "  https://docs.docker.com/desktop/wsl/"
  exit 1
fi

# Verifica se o Docker daemon está rodando
if ! docker info &>/dev/null 2>&1; then
  echo -e "${RED}✗ Docker daemon não está rodando.${RESET}"
  echo "  Abra o Docker Desktop no Windows e aguarde inicializar."
  exit 1
fi

# ── Subir containers ───────────────────────────────────────────────────────────
echo -e "${CYAN}▶ Construindo imagem e subindo containers...${RESET}"
docker compose up --build -d
echo ""

# ── Aguardar banco de dados ────────────────────────────────────────────────────
echo -e "${CYAN}▶ Aguardando o banco de dados (PostgreSQL)...${RESET}"
printf "  "
until docker compose exec -T db pg_isready -U pioerp -d pioerp -q 2>/dev/null; do
  printf "${DIM}.${RESET}"
  sleep 1
done
echo -e " ${GREEN}pronto!${RESET}"
echo ""

# ── Aguardar API ───────────────────────────────────────────────────────────────
echo -e "${CYAN}▶ Aguardando a API (Node.js)...${RESET}"
printf "  "
MAX_WAIT=30
COUNT=0
until curl -sf http://localhost:3000/api/health >/dev/null 2>&1; do
  printf "${DIM}.${RESET}"
  sleep 1
  COUNT=$((COUNT + 1))
  if [ $COUNT -ge $MAX_WAIT ]; then
    echo ""
    echo -e "${YELLOW}⚠ A API demorou mais que o esperado. Verificando logs...${RESET}"
    docker compose logs --tail=20 api
    echo ""
    echo -e "${YELLOW}Tente acessar http://localhost:3000 em alguns instantes.${RESET}"
    break
  fi
done
[ $COUNT -lt $MAX_WAIT ] && echo -e " ${GREEN}pronta!${RESET}"
echo ""

# ── Sucesso ────────────────────────────────────────────────────────────────────
echo -e "${GREEN}${BOLD}✓ PIOERP está rodando!${RESET}"
echo ""
echo -e "  ${BOLD}Acesse no navegador:${RESET}  ${CYAN}http://localhost:3000${RESET}"
echo ""
echo -e "${DIM}─────────────────────────────────────────${RESET}"
echo -e "${YELLOW}Comandos úteis:${RESET}"
echo -e "  ${BOLD}./stop.sh${RESET}                      — para o sistema"
echo -e "  ${BOLD}docker compose logs -f${RESET}         — acompanhar todos os logs"
echo -e "  ${BOLD}docker compose logs -f api${RESET}     — logs apenas da API"
echo -e "  ${BOLD}docker compose logs -f db${RESET}      — logs do PostgreSQL"
echo -e "  ${BOLD}docker compose restart api${RESET}     — reiniciar a API"
echo -e "  ${BOLD}docker compose down -v${RESET}         — parar e ${RED}apagar dados${RESET}"
echo -e "${DIM}─────────────────────────────────────────${RESET}"
echo ""
