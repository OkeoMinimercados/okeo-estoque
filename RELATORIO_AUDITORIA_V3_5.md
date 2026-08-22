# Auditoria técnica OKEO Core V3.5

Resultado: 19/19 verificações estruturais aprovadas.

- [x] Syntax app-v3.5.0.js
- [x] Syntax db.js
- [x] Syntax sw.js
- [x] Syntax Apps Script
- [x] Referências HTML
- [x] IDs HTML únicos
- [x] Funções JS sem duplicidade
- [x] Handlers do bind definidos
- [x] Menu → telas
- [x] Renderizadores de telas definidos
- [x] SYNC stores existem no DB
- [x] SYNC stores existem no backend
- [x] Funções internas Apps Script definidas
- [x] Ações backend obrigatórias
- [x] Contrato de autenticação estrito
- [x] Helpers operacionais críticos
- [x] Fluxos críticos presentes
- [x] Frontend versão 3.5
- [x] Backend versão 3.5

## Homologação de navegador
Foi preparada uma bateria de navegação em Chromium com backend simulado, porém o ambiente de execução bloqueia navegação para localhost e file:// por política administrativa. Assim, o teste visual completo deve ser concluído após publicação usando o Autoteste e a Integridade embutidos.

## Correções adicionais desta versão
- Camada utilitária crítica restaurada (moeda, escape, anexos, auditoria, sincronização, lotes/FEFO, cobertura/ruptura).
- Compras sem validade mantêm lotes conciliados.
- Validade manual não duplica estoque.
- Compras liquidam reposições externas pendentes.
- Demanda recalculada atualiza a base operacional da reposição.
- Grupos substituíveis usam todos os EANs do grupo.
- Sessões expiradas são limpas no backend.

## Smoke tests executados
- BACKEND_SMOKE_OK — senha errada rejeitada; Admin autenticado; funcionário criado/autenticado; perfil criado; troca de senha validada.
- FRONTEND_SMOKE_OK — resposta genérica `ok:true` não autentica; contrato OKEO_AUTH_V1 validado; consumo FEFO e reconciliação de lotes testados.
- Validação estrutural: 19/19 verificações aprovadas.
