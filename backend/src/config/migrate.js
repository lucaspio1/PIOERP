'use strict';

const fs   = require('fs');
const path = require('path');
const db   = require('./database');

// ── Diretório de migrations ─────────────────────────────────────────────────
// Docker:        /app/database/migrations  (copiado pelo Dockerfile)
// Dev local:     ../../database/migrations  (relativo a backend/src/config/)
const MIGRATIONS_DIR = process.env.MIGRATIONS_PATH
  ? path.resolve(process.env.MIGRATIONS_PATH)
  : path.join(__dirname, '../../../database/migrations');

/**
 * Executa migrations pendentes de forma sequencial e idempotente.
 *
 * Usa uma tabela `_migrations_applied` para rastrear quais arquivos já foram
 * executados. Migrations incorporadas ao schema.sql (001–007) são registradas
 * sem re-execução quando a tabela de controle é criada pela primeira vez.
 */
async function runMigrations() {
  // 1. Verifica se o diretório de migrations existe
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[MIGRATE] Diretório de migrations não encontrado:', MIGRATIONS_DIR);
    return;
  }

  // 2. Cria tabela de controle se não existir
  const isNewTracker = await ensureTrackingTable();

  // 3. Se acabamos de criar a tabela de controle, marca migrations 001-007
  //    como já aplicadas (estão incorporadas no schema.sql)
  if (isNewTracker) {
    await markIncorporatedMigrations();
  }

  // 4. Lista arquivos de migration ordenados
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.log('[MIGRATE] Nenhum arquivo de migration encontrado.');
    return;
  }

  // 5. Busca migrations já aplicadas
  const { rows } = await db.query('SELECT filename FROM _migrations_applied');
  const applied = new Set(rows.map(r => r.filename));

  // 6. Aplica pendentes
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`[MIGRATE] Aplicando: ${file} ...`);
    try {
      await db.query(sql);
      await db.query(
        'INSERT INTO _migrations_applied (filename) VALUES ($1)',
        [file]
      );
      console.log(`[MIGRATE] OK: ${file}`);
      count++;
    } catch (err) {
      console.error(`[MIGRATE] ERRO ao aplicar ${file}:`, err.message);
      throw err;
    }
  }

  if (count > 0) {
    console.log(`[MIGRATE] ${count} migration(s) aplicada(s) com sucesso.`);
  } else {
    console.log('[MIGRATE] Banco de dados já está atualizado.');
  }
}

/**
 * Cria a tabela de controle _migrations_applied se não existir.
 * Retorna true se a tabela foi criada agora (primeira execução).
 */
async function ensureTrackingTable() {
  const check = await db.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = '_migrations_applied'
    ) AS exists
  `);

  if (check.rows[0].exists) return false;

  await db.query(`
    CREATE TABLE _migrations_applied (
      id         SERIAL       PRIMARY KEY,
      filename   VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  console.log('[MIGRATE] Tabela de controle _migrations_applied criada.');
  return true;
}

/**
 * Marca migrations 001-007 como já aplicadas.
 * Estas estão incorporadas no schema.sql e não precisam ser re-executadas.
 */
async function markIncorporatedMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    // Migrations 001-007 estão incorporadas no schema.sql
    const num = parseInt(file.split('_')[0], 10);
    if (num >= 1 && num <= 7) {
      await db.query(
        'INSERT INTO _migrations_applied (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [file]
      );
    }
  }

  console.log('[MIGRATE] Migrations 001-007 marcadas como incorporadas (schema.sql).');
}

module.exports = runMigrations;
