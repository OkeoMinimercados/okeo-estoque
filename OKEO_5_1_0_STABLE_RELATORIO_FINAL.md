# OKEO Gestão 5.1 Stable — transporte sem CORS

A homologação 5.0 mostrou um bloqueio que o teste local não poderia provar: a navegação direta ao Apps Script funcionava, mas `fetch` do GitHub Pages era bloqueado por CORS.

A 5.1 remove o `fetch` da comunicação com a Base Central. Todas as ações usam formulário POST para iframe oculto e resposta via `postMessage`, com validação do `window.source`, canal e request ID. O Apps Script retorna HtmlService com `XFrameOptionsMode.ALLOWALL`. Portanto a comunicação não depende de `Access-Control-Allow-Origin` nem de preflight OPTIONS.

Permanecem: backend único, máquina de estados, sessão/snapshot/fila por backend, quarentena de fila antiga, sincronização coordenada, hidratação explícita e rollback.

Testes: sintaxe, rotas bridge de leitura/escrita, payload Unicode, transporte sem fetch, 100.000 combinações de estado com 0 violações e fluxos críticos preservados.
