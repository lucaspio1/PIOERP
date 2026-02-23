'use strict';

/**
 * Middleware global de tratamento de erros.
 * Captura erros lançados pelos controllers e formata a resposta.
 */
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV === 'development';

  // Erros do PostgreSQL
  if (err.code && err.code.match(/^\d{5}$/)) {
    const pgMessages = {
      '23505': 'Registro duplicado: um campo único já existe com esse valor.',
      '23503': 'Operação bloqueada: existem registros dependentes.',
      '23514': `Violação de regra de negócio: ${err.detail || err.message}`,
      'P0001': err.message, // mensagens de RAISE EXCEPTION
    };
    const message = pgMessages[err.code] || `Erro de banco de dados: ${err.message}`;
    return res.status(409).json({ success: false, message });
  }

  // Erros de validação explícitos lançados pelos controllers
  if (err.status === 400 || err.statusCode === 400) {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err.status === 404 || err.statusCode === 404) {
    return res.status(404).json({ success: false, message: err.message });
  }
  if (err.status === 422 || err.statusCode === 422) {
    return res.status(422).json({ success: false, message: err.message });
  }

  // Erro genérico
  console.error('[ERROR]', err.stack || err.message);
  res.status(500).json({
    success: false,
    message: 'Erro interno do servidor.',
    ...(isDev && { detail: err.message, stack: err.stack }),
  });
};
