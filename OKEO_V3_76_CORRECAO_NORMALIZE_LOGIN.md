# OKEO V3.76 — Correção normalizeLoginUsername_

O clique do botão passou a ser executado na V3.75 e revelou um segundo erro:
`normalizeLoginUsername_ is not defined`.

A função era referenciada pelo JavaScript do navegador, mas não estava definida
nesse frontend. Foram adicionados os helpers de normalização de usuário e senha
no próprio frontend, mantendo a mesma regra usada no fluxo de autenticação.

Também foram mantidas as proteções do botão/bootstrap da V3.75.

Validação: sintaxe frontend/backend, presença dos helpers, fallback do botão,
versionamento/cache e smoke test em runtime.
