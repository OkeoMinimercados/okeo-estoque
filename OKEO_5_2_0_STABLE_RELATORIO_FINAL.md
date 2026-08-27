# OKEO Gestão 5.2 Stable — estabilização do transporte real

## Causa raiz do bloqueio 5.1

A 5.1 usava um formulário POST para navegar um iframe até o Apps Script e esperava uma
resposta por `postMessage`. No ambiente publicado, o iframe não concluía o retorno e status/login
terminavam em timeout.

## Arquitetura 5.2

A interface continua no GitHub Pages para preservar a origem do navegador e, portanto, o
IndexedDB já existente no computador e celular.

O frontend não usa `fetch`, XHR nem formulário para conversar com a Base Central. Ele carrega
uma única página bridge do Apps Script em iframe oculto. Essa página é entregue por HtmlService
com `XFrameOptionsMode.ALLOWALL`, possui `google.script.run` nativo e permanece carregada.

Fluxo:
1. GitHub carrega `?uiBridge=1` uma única vez.
2. Bridge confirma `ready` por `postMessage`.
3. Frontend envia uma mensagem com `clientId`, `requestId`, ação e parâmetros.
4. Bridge executa `google.script.run.okeoRpc()` dentro do Apps Script.
5. Bridge devolve resultado/erro ao frontend por `postMessage`.
6. Frontend só aceita mensagens do iframe correto, com canal, client e request id corretos.

Não existe CORS no canal RPC, porque a chamada ao servidor é feita nativamente de dentro do
Apps Script.

## Proteções

- uma Base Central oficial (`...IJQBAutw`);
- fila vinculada ao backend;
- fila legada em quarentena;
- snapshot por backend;
- sessão vinculada à Base Central;
- máquina de estados READY/PREPRODUCTION/NEEDS_HYDRATION/OFFLINE;
- um único coordenador de sincronização;
- hidratação automática desativada;
- rollback de snapshot e backup;
- seed de planogramas embutido no frontend, sem fetch adicional.

## Testes executados

- auditoria estrutural: 88/88 aprovada;
- sintaxe frontend, backend, DB e Service Worker;
- rotas frontend/backend;
- ausência de fetch/XHR/form POST no transporte RPC;
- validação de source/client/request ID;
- handlers e IDs de DOM;
- uma única implantação oficial;
- 100.000 combinações aleatórias de estado: 0 violações de envio indevido;
- navegador headless: status e login pelo bridge simulando Apps Script;
- navegador headless: 50 RPCs concorrentes e fora de ordem, todos associados à resposta correta;
- navegador headless: erro do servidor propagado corretamente;
- navegador headless: timeout, reset do iframe e chamada seguinte recuperada;
- fluxo de contagem, compras, CD, validade, fornecedor exclusivo, backup e rollback preservados.

## Critério final

Esta versão resolve as classes de falha identificadas até aqui sem mudar a origem dos dados
locais. A única parte que só pode ser provada após publicação é o comportamento do HtmlService
real da implantação Google. Se `Base Central online` e login passarem no ambiente publicado,
essa release deve ser congelada. Não iniciar nova rodada de melhorias preventivas depois disso.
