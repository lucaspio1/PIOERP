'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:                  process.env.DB_HOST                 || 'localhost',
  port:            parseInt(process.env.DB_PORT              || '5432', 10),
  database:              process.env.DB_NAME                 || 'pioerp',
  user:                  process.env.DB_USER                 || 'postgres',
  password:              process.env.DB_PASSWORD             || '',
  max:             parseInt(process.env.DB_POOL_MAX          || '20',   10),
  idleTimeoutMillis:  parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '2000', 10),
});

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool de conexões:', err.message);
});

pool.on('connect', () => {
  if (process.env.NODE_ENV === 'development') {
    console.log('[DB] Nova conexão estabelecida');
  }
});

/**
 * Executa uma query simples.
 * @param {string} text  - SQL
 * @param {Array}  params - parâmetros posicionais
 */
const query = (text, params) => pool.query(text, params);

/**
 * Retorna um cliente do pool para transações manuais.
 * Lembre-se de chamar client.release() após o uso.
 */
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
