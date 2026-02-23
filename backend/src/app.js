'use strict';

require('dotenv').config();

const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const morgan   = require('morgan');
const path     = require('path');

const routes       = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const db           = require('./config/database');

// ── Resolução do caminho do frontend ──────────────────────────────────────────
// Docker:      FRONTEND_PATH=/app/frontend  (setado no docker-compose.yml)
// Desenvolvimento local: não definido → resolve ../../frontend a partir de backend/src/
const frontendPath = process.env.FRONTEND_PATH
  ? path.resolve(process.env.FRONTEND_PATH)
  : path.join(__dirname, '../../frontend');

// ── Retry de conexão com o banco ──────────────────────────────────────────────
// Garante que a API só sobe depois que o PostgreSQL está pronto,
// mesmo em ambientes onde o healthcheck do Docker já passou mas o PG
// ainda está processando scripts de inicialização.
async function aguardarBanco(tentativas = 15, intervaloMs = 2000) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await db.query('SELECT 1');
      console.log('[DB] Conexão estabelecida com sucesso.');
      return;
    } catch (err) {
      if (i === tentativas) {
        console.error('[DB] Não foi possível conectar ao banco após', tentativas, 'tentativas.');
        throw err;
      }
      console.log(`[DB] Aguardando banco... (tentativa ${i}/${tentativas}): ${err.message}`);
      await new Promise(r => setTimeout(r, intervaloMs));
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  await aguardarBanco();

  const app = express();

  // ── Security & parsing ──────────────────────────────────────────────────────
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // ── Frontend estático ───────────────────────────────────────────────────────
  app.use(express.static(frontendPath));

  // ── Rotas da API ────────────────────────────────────────────────────────────
  app.use('/api', routes);

  // ── SPA catch-all ───────────────────────────────────────────────────────────
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // ── Handler global de erros (deve ser o último) ─────────────────────────────
  app.use(errorHandler);

  // ── Iniciar servidor ────────────────────────────────────────────────────────
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[PIOERP] API rodando em http://localhost:${PORT}`);
    console.log(`[PIOERP] Ambiente:  ${process.env.NODE_ENV || 'development'}`);
    console.log(`[PIOERP] Frontend:  ${frontendPath}`);
  });
}

bootstrap().catch(err => {
  console.error('[PIOERP] Falha fatal na inicialização:', err.message);
  process.exit(1);
});
