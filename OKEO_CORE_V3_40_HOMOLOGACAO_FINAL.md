# OKEO Core V3.40 — Homologação Final

Data: 23/08/2026

## Motivo da versão
Correção de regressão identificada na V3.39: navegação sem comando claro de retorno ao Dashboard e execução de carga crítica antes da abertura da interface, além da possibilidade de exibição da rotina automática de primeiro acesso no fluxo normal.

## Correções aplicadas
- Dashboard volta a abrir imediatamente após autenticação.
- Sincronização e recarga de referências passam a executar em segundo plano, sem bloquear a navegação.
- Sincronização concluída não redireciona o usuário para outra tela; a tela ativa é preservada.
- Adicionado botão permanente `⌂ Dashboard` no topo de todas as telas.
- Mantido o botão Dashboard no menu lateral.
- Removida do frontend a interface automática de `Primeiro acesso`/bootstrap do fluxo normal já implantado.
- Login, sessão e `Manter conectado` foram preservados.
- Correções da V3.39 foram mantidas: Produto × Condomínio, recarga integral das bases críticas, fornecedores, fornecedor × produto, planogramas e tabela da Movimentação CD.

## Validação de navegação
19/19 verificações aprovadas:
- HTML referencia `app-v3.40.0.js`.
- versão visível V3.40.
- botão Dashboard no topo presente e ligado a `view("home")`.
- Dashboard é renderizado antes da carga crítica.
- carga crítica roda em segundo plano.
- sincronização não força retorno para `firstAllowedView` após concluir.
- interface automática de bootstrap ausente.
- Service Worker aponta para V3.40.
- nenhum ID HTML duplicado.
- todas as views principais presentes.

## Regressão funcional
35/35 verificações aprovadas, cobrindo:
- Dashboard;
- Gestão de Estoque;
- Contagem de Estoque;
- Compras/Reposição;
- Movimentação CD;
- Condomínios e Fornecedores;
- Produtos;
- Validades;
- Vendas;
- Demanda;
- stores `products`, `units`, `planograms`, `stock`, `demandCurrent`, `supplierOffers` e `suppliers` no fluxo de sincronização;
- vínculo fornecedor × produto;
- recuperação Produto × Condomínio;
- permissão de gravação de `planograms` no backend;
- login e persistência de sessão.

## Performance sintética
Teste de deduplicação/relação com 300.000 vínculos Produto × Condomínio: aproximadamente 38 ms no ambiente de teste, formando 3.000 chaves únicas no cenário sintético.

## Sintaxe e integridade
- `app-v3.40.0.js`: `node --check` aprovado.
- backend Apps Script V3.40: sintaxe JavaScript aprovada.
- IDs HTML duplicados: 0.
- Pacotes ZIP testados após geração.

## Limitações do ambiente
Câmera física, permissões reais do navegador, OAuth/Google Drive, cache real do GitHub Pages e latência real do Apps Script precisam ser confirmados após publicação. Esses itens não foram artificialmente marcados como aprovados.

## Smoke test após publicar
1. Confirmar `v3.40.0` no topo.
2. Entrar normalmente e confirmar que o primeiro conteúdo é o Dashboard.
3. Abrir Gestão de Estoque e clicar no botão `Dashboard` do topo.
4. Abrir Contagem de Estoque e repetir o retorno ao Dashboard.
5. Confirmar que nenhuma tela de `Primeiro acesso` aparece.
6. Confirmar que a sincronização pode mudar de `Conectando…` para `Online` sem trocar a tela atual.
7. Conferir Produto × Condomínio em pelo menos três unidades.
8. Conferir lista completa de fornecedores e fornecedor × produto.
9. Conferir Movimentação CD em tabela.
