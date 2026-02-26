/**
 * PIOERP — API Client
 * Camada de abstração sobre fetch para todas as chamadas à API REST.
 * Base URL: /api (mesmo host, sem CORS em produção)
 */

const API_BASE = '/api';

const Api = (() => {
  /**
   * Executa uma requisição fetch com tratamento de erro padronizado.
   * Retorna os dados parseados ou lança um Error com a mensagem da API.
   */
  async function request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, opts);
    } catch (networkErr) {
      throw new Error('Falha de conexão com o servidor. Verifique se a API está rodando.');
    }

    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      throw new Error(json.message || `Erro HTTP ${response.status}`);
    }

    return json;
  }

  return {
    get:    (path)        => request('GET',    path),
    post:   (path, body)  => request('POST',   path, body),
    put:    (path, body)  => request('PUT',    path, body),
    delete: (path)        => request('DELETE', path),

    // Atalhos semânticos por recurso
    catalogo: {
      listar:    ()      => Api.get('/catalogo'),
      buscarId:  (id)    => Api.get(`/catalogo/${id}`),
      criar:     (data)  => Api.post('/catalogo', data),
      atualizar: (id, d) => Api.put(`/catalogo/${id}`, d),
      remover:   (id)    => Api.delete(`/catalogo/${id}`),
    },

    endereco: {
      listar:    ()      => Api.get('/endereco'),
      criar:     (data)  => Api.post('/endereco', data),
      atualizar: (id, d) => Api.put(`/endereco/${id}`, d),
    },

    equipamento: {
      listar:       (status) => Api.get(`/equipamento${status ? `?status=${status}` : ''}`),
      buscarId:     (id)     => Api.get(`/equipamento/${id}`),
      entrada:      (data)   => Api.post('/equipamento/entrada', data),
      saida:        (id, d)  => Api.post(`/equipamento/${id}/saida`, d),
      montarPallet: (data)   => Api.post('/equipamento/montar-pallet', data),
    },

    movimentacao: {
      listar:         (equipId) => Api.get(`/movimentacao${equipId ? `?equipamento_id=${equipId}` : ''}`),
      estoqueCritico: ()        => Api.get('/movimentacao/estoque-critico'),
      dashboard:      ()        => Api.get('/movimentacao/dashboard'),
    },

    internalizacao: {
      listar:          ()           => Api.get('/internalizacao'),
      locaisPorModelo: (catalogo_id) => Api.get(`/internalizacao/locais-por-modelo/${catalogo_id}`),
      aprovar:         (id, data)   => Api.post(`/internalizacao/${id}/aprovar`, data),
    },

    pallets: {
      listar:  (endereco_id) => Api.get(`/pallets${endereco_id ? `?endereco_id=${endereco_id}` : ''}`),
      criar:   (data)        => Api.post('/pallets', data),
    },

    caixas: {
      listar: (pallet_id) => Api.get(`/caixas${pallet_id ? `?pallet_id=${pallet_id}` : ''}`),
      criar:  (data)      => Api.post('/caixas', data),
    },

    reparo: {
      prioridades:         ()           => Api.get('/reparo/prioridades'),
      criticos:            ()           => Api.get('/reparo/criticos'),
      buscarId:            (id)         => Api.get(`/reparo/${id}`),
      atualizar:           (id, d)      => Api.put(`/reparo/${id}`, d),
      iniciar:             (id)         => Api.post(`/reparo/${id}/iniciar`, {}),
      pausar:              (id)         => Api.post(`/reparo/${id}/pausar`, {}),
      finalizar:           (id, d)      => Api.post(`/reparo/${id}/finalizar`, d),
      solicitarLote:       (data)       => Api.post('/reparo/solicitar-lote', data),
      listarSolicitacoes:  (status)     => Api.get(`/reparo/solicitacoes${status ? `?status=${status}` : ''}`),
      atualizarSolicitacao:(id, d)      => Api.put(`/reparo/solicitacoes/${id}`, d),
    },
  };
})();
