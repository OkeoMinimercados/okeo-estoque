# OKEO V3.63 — Demanda Inteligente

## Problemas encontrados
1. O cálculo de demanda gravava eventos de ruptura produto a produto, de forma sequencial no IndexedDB.
2. A importação histórica gravava `demandBase` registro por registro.
3. O seletor de período (4/8/12/16 semanas) não participava efetivamente do cálculo operacional.
4. O usuário não recebia progresso durante o processamento, dando a impressão de travamento.

## Correções
- eventos de ruptura processados em lote;
- `demandBase` gravada com `putMany` e sincronização em lote;
- período selecionado passa a limitar o peso histórico e as semanas recentes consideradas;
- cálculo libera a interface a cada bloco de 250 itens;
- barra de progresso com etapas;
- mensagem final mostra tempo, quantidade de resultados, registros históricos e vendas semanais;
- `demandCurrent` obsoleto da unidade é removido antes da nova gravação.

## Homologação
13/13 verificações aprovadas.

Teste sintético de agregação com 300.000 registros: ~28 ms.

Frontend, Service Worker e backend Apps Script passaram na validação de sintaxe.
