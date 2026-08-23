# OKEO Core V3.43 — Homologação final

Data: 23/08/2026

## Resultado
**APROVADO para implantação controlada e smoke test no ambiente publicado.**

A V3.42 foi tratada como candidata. A revisão encontrou falhas reais de relação Produto × Condomínio, navegação do Planograma, cache de Service Worker e desempenho da sincronização. As falhas foram corrigidas antes do empacotamento V3.43.

## Falhas identificadas e corrigidas
1. **Mix de condomínio contaminado:** `canonicalUnitProductEans()` unia ao planograma oficial também `stock`, `demand` e `products.unitIds`. Dados antigos contaminados podiam fazer Jomar, por exemplo, aparecer com toda a Base Mestre (1.245 produtos). Na V3.43, unidades já homologadas usam seed + planogramas confiáveis; fontes auxiliares só são fallback para unidades novas sem seed.
2. **Planogramas automáticos antigos:** vínculos com `source=RECONCILIACAO_AUTOMATICA` fora do seed oficial são desativados pela migração V3.43. Inclusões manuais, importações e novos produtos continuam permitidos.
3. **Aba removida ainda referenciada:** após remover “Condomínios por produto”, `setPlanogramMode()` ainda acessava elementos inexistentes e podia gerar erro ao clicar nas abas restantes. A função foi simplificada para apenas `unit` e `import`, e o código morto da aba removida foi eliminado.
4. **Service Worker com cache antigo:** a candidata ainda usava `okeo-core-v3-41-final`. Corrigido para `okeo-core-v3-43-final` e assets V3.43.
5. **Carga inicial pesada:** a recarga crítica do login baixava Compras e NFs completas. Esses históricos foram retirados do bootstrap crítico e permanecem carregados sob demanda em Compras.
6. **IndexedDB com gravações seriadas:** adicionada `putMany()` para cargas em lote e aplicada em full sync, delta remoto e recargas integrais.
7. **Fornecedor × Produto:** reconciliação de fornecedores e `supplierOffers` agora grava dados e fila de sync em lote (`queueMany`).
8. **Exportação de diferenças:** o CSV de diferenças de contagem agora respeita condomínio, busca e filtro “somente diferenças/todos”.
9. **Última importação de vendas:** corrigido `salesFile` → `salesfile`, para registrar corretamente o nome do arquivo importado.
10. **Setup backend:** disponibilizado `setupOkeoCoreV343()` mantendo aliases de compatibilidade.

## Relação oficial Produto × Condomínio
O seed V3.43 contém 7 unidades de referência e mixes distintos:
- Condomínio Jomar: 536 itens de referência
- Dom Vicente: 825
- Life Residence: 966
- Riviera Business & Mall: 599
- Condomínio Ville de Leon: 1.299
- Luna Bella: 750
- Luna Itaipava: 749

O CD continua utilizando toda a Base Mestre. Planogramas explicitamente alterados pelo usuário prevalecem sobre o seed.

## Validação automatizada
- `node --check` frontend: aprovado.
- `node --check` db.js: aprovado.
- `node --check` Service Worker: aprovado.
- `node --check` backend Apps Script (cópia .js): aprovado.
- HTML: zero IDs duplicados.
- Todos os botões HTML possuem handler direto ou binding JavaScript.
- Handlers dinâmicos renderizados pelo JavaScript resolvem para funções existentes.
- Matriz estrutural V3.43: **45/45 verificações aprovadas**.
- Matriz de fluxos dos 13 módulos: **42/42 verificações aprovadas**.
- Harness real de `canonicalUnitProductEans()`: aprovado para mix contaminado, inclusão manual, exclusão manual, unidade nova sem seed e CD.
- Harness de `setPlanogramMode()`: aprovado sem referências à aba removida.
- Fórmula Compra Semanal: cenário estoque 10 / média 40 / alerta 4 / 7 dias / CD 0 = mínimo 30 e recomendado 34.

## Testes de carga locais
Carga sintética em JavaScript/Node:
- 300.000 relações Produto × Unidade: construção ~146 ms; filtro/consolidação de uma unidade ~55 ms.
- 50.000 vínculos Fornecedor × Produto: preparação ~35 ms.

Esses tempos medem processamento em memória no ambiente de homologação. Rede, Google Apps Script, IndexedDB real do navegador e dispositivo do usuário acrescentam latência. A V3.43 reduz o número de transações IndexedDB usando gravação em lote e evita baixar histórico completo de Compras/NFs no login.

## Fluxos revisados
Dashboard e navegação; autenticação e manter conectado; Base Mestre; cadastro Produto × Condomínio; Planograma e importação; Gestão de Estoque; relatório de diferenças; Contagem Física e aprovação; histórico de posições; Validades/FEFO; Movimentação CD; Fornecedores × Produtos; Compra Semanal; Reposição operacional; lançamento manual/NF; Ajustes de Estoque; Grupos; Vendas; Demanda Inteligente; usuários/perfis; auditoria; integridade; sincronização e fila offline.

## Limitação do ambiente de homologação
O Chromium está instalado, porém a política do ambiente bloqueia navegação para `localhost`, `file://` e origens de teste (`ERR_BLOCKED_BY_ADMINISTRATOR`). Por isso não foi possível executar um E2E visual completo com IndexedDB real nesta sessão. Câmera física, permissões do navegador, Google Drive/OAuth, latência do Apps Script e publicação GitHub Pages também exigem smoke test no ambiente publicado. Esses itens **não foram marcados artificialmente como aprovados**.

## Smoke test obrigatório após publicar
1. Publicar todo o ZIP GitHub V3.43, incluindo `seed-planograms-v3.43.json`.
2. Publicar/atualizar o Apps Script V3.43.
3. Fazer atualização forçada do navegador/PWA para substituir o Service Worker antigo.
4. Confirmar que Jomar não exibe mais a Base Mestre inteira e que Jomar/Ville/Luna têm quantidades distintas.
5. Confirmar a mesma lista em Gestão de Estoque, Contagem Física, Validades e Planograma.
6. Executar uma contagem de teste, aprovar e conferir o relatório de diferenças.
7. Testar Movimentação CD com saldo positivo e com CD totalmente zerado.
8. Conferir Fornecedores × Produtos e filtros da Compra Semanal.
9. Gerar um rascunho de Reposição, retirar/restaurar um item e não aprovar produção até conferir o PDF.
10. Executar Configurações → Autoteste e Verificação de Integridade no ambiente publicado.
