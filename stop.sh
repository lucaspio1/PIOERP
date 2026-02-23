#!/usr/bin/env bash
# =============================================================================
# PIOERP — Script de parada (WSL / Linux)
# Uso: ./stop.sh
# =============================================================================
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

echo ""
echo -e "${YELLOW}▶ Parando PIOERP...${RESET}"
docker compose down
echo ""
echo -e "${GREEN}${BOLD}✓ Containers parados. Dados preservados.${RESET}"
echo ""
echo -e "  Para apagar os dados do banco também:"
echo -e "  ${BOLD}docker compose down -v${RESET}"
echo ""
