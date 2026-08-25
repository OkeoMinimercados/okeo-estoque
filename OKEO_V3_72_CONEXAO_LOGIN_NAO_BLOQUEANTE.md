# OKEO V3.72 — Conexão e login não bloqueantes

## Problema identificado
O teste de status da Base Central usava `fetch` sem timeout.
Se a requisição ficasse pendente no desktop, a tela permanecia em
`Verificando conexão...` e o login aguardava a verificação antes de autenticar.

## Correções
- toda chamada à Base Central ganhou timeout via AbortController;
- teste visual de status: 4,5 segundos;
- autenticação: 12 segundos;
- login não depende mais do teste de status;
- o botão Entrar faz a autenticação diretamente na URL oficial;
- status roda em paralelo e é apenas informativo;
- se o teste de status demorar, a tela informa que o login continua disponível;
- inicialização do sistema não aguarda o status antes de mostrar o login;
- segunda tentativa de status usa a URL oficial.

## Diagnóstico anterior preservado
A V3.72 continua mostrando:
- versão do backend;
- fingerprint da Base Central;
- USER_NOT_FOUND / PASSWORD_MISMATCH;
- identificador da Base que respondeu.

## Validação
11/11 verificações aprovadas.
