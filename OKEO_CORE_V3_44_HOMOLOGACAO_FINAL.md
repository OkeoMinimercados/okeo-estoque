# OKEO Core V3.44 — Homologação final

Data: 23/08/2026

## Resultado
**APROVADO em validação estrutural, lógica e de performance local para publicação controlada.**

## Falhas identificadas e corrigidas
1. **Compras → Reposição operacional**: V3.43 não aceitava `replenishment` na lista de abas válidas de `showPurchaseTab()`. Corrigido; o painel e botão agora alternam corretamente e chamam `renderReplenishment()`.
2. **Histórico de homologação**: migração V3.44 limpa uma única vez os registros existentes de `replenishments` para Administrador e sincroniza as exclusões com a Base Central. Novos registros criados após a migração permanecem normalmente.
3. **Gestão de Estoque → Análise de divergências**: a lógica existia, mas faltava uma aba própria visível. Incluída aba/painel com condomínio, pesquisa, filtro somente divergências/todos, resumo, tabela e exportação CSV.
4. **Fornecedor único por produto**: `setExclusiveSupplierForProduct()` desativa todos os fornecedores anteriores do mesmo EAN, ativa somente o novo e atualiza `products.supplier`/`supplierId`. Compras/NF também usam essa regra.
5. **Total de fornecedores**: cadastro exibe apenas `Total de fornecedores ativos: X` como indicador agregado, sem análises adicionais.
6. **Versionamento/cache**: frontend, backend, seed e Service Worker atualizados para V3.44; cache `okeo-core-v3-44-final`.

## Validação executada
- `node --check` frontend V3.44: aprovado.
- `node --check` backend Apps Script (cópia JS): aprovado.
- HTML: zero IDs duplicados.
- 153 controles com `onclick`/`onchange`/`oninput`: **0 IDs ausentes**.
- Suíte estrutural/lógica V3.44: **73/73 verificações aprovadas**.
- Reposição operacional: botão, painel, modo permitido, classe ativa e chamada de renderização verificados.
- Análise de divergências: botão, painel, filtros, cálculo esperado × observado e exportação verificados.
- Produto × Condomínio: planograma/seed oficial continua sendo a referência para unidades homologadas; CD continua usando toda Base Mestre.
- Fornecedor × Produto: teste de unicidade e migração para fornecedor exclusivo aprovados.
- Compra semanal: cenário estoque=10, média=40/semana, alerta=4, CD=0 retorna **mínimo 30 / recomendado 34**.
- Seed de planogramas: 7 unidades com mix não vazio (Jomar 535; Dom Vicente 824; Life 965; Riviera 598; Ville de Leon 1.294; Luna Bella 748; Luna Itaipava 746 EANs válidos).

## Performance local
- Consolidação sintética de **300.000 relações Produto × Unidade**: ~525 ms.
- **100.000 trocas de fornecedor** em modelo de unicidade: ~28 ms.

Os tempos acima medem processamento local e não incluem rede/Apps Script.

## Limitação do ambiente
Foi tentado smoke test automatizado em Chromium real, porém o ambiente bloqueou navegação para `localhost` e `file://` com `ERR_BLOCKED_BY_ADMINISTRATOR`. Por isso câmera, Service Worker efetivamente instalado e latência real do Apps Script continuam exigindo smoke test depois da publicação. Essa limitação não foi marcada artificialmente como aprovada.

## Implantação
1. Publicar todo o conteúdo do ZIP GitHub V3.44.
2. Publicar/atualizar o Apps Script V3.44.
3. Fazer atualização forçada/limpeza de cache do PWA.
4. Entrar como Administrador; a limpeza única do histórico de reposições de homologação será executada.
5. Confirmar Reposição operacional, Análise de divergências e fornecedor único em um teste curto com dados reais.
