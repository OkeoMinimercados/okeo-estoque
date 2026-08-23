# OKEO Core V3.38 — Homologação Final

**Data:** 23/08/2026  
**Status:** APROVADO PARA IMPLANTAÇÃO CONTROLADA E SMOKE TEST NO AMBIENTE PUBLICADO

## Resultado da bateria

A suíte automatizada final executou **40/40 verificações aprovadas**. Também foram executados testes adicionais de estrutura de navegação, integridade do Service Worker, integridade dos pacotes e carga sintética da reconciliação Produto × Condomínio.

## Falhas encontradas e corrigidas

1. **Parser CSV duplicado no frontend.** Existiam duas declarações de `parseDelimitedRows`, o que permitia uma sobrescrever a outra. O parser de DE/PARA foi separado como `parseDeparaDelimitedRows`.
2. **Reconciliação Produto × Condomínio com trabalho redundante.** A rotina anterior chamava a função de garantia de vínculo para todos os produtos já corretos, causando leituras IndexedDB e validações desnecessárias. A V3.38 só repara planograma ou `unitIds` quando houver inconsistência real.
3. **Identificação de versão do backend defasada.** O backend compatível declarava uma versão antiga. A identificação operacional foi atualizada para `3.38.0`, mantendo o contrato de dados existente e um alias de compatibilidade para a rotina de setup antiga.

## Integrações validadas

- Base Mestre ↔ Produto × Condomínio (`planograms` + `unitIds`).
- Gestão de Estoque por condomínio usa a relação canônica.
- Contagem de Estoque Física usa a mesma relação canônica.
- Incremento de estoque exige produto cadastrado e garante vínculo da unidade antes de atualizar saldo.
- Cadastro de produto grava condomínios selecionados e recupera vínculos na edição.
- Fornecedor × Produto usa `suppliers` + `supplierOffers` e permite múltiplos fornecedores por produto.
- Compra semanal preventiva e Reposição operacional permanecem dentro de Compras.
- Prioridade de abastecimento: **CD primeiro; compra externa somente para o saldo faltante**.
- Fórmula de compra preventiva validada no exemplo Coca-Cola 2L: estoque 10, média semanal 40, alerta 4, horizonte 7 dias → **mínimo 30 / recomendado 34** sem saldo no CD.

## Testes técnicos aprovados

- Sintaxe `app-v3.38.0.js`, `db.js`, `sw.js` e backend Apps Script.
- HTML: **383 IDs e 0 duplicados**.
- Manifest válido.
- Todos os assets referenciados pelo HTML presentes.
- Todos os assets do Service Worker presentes.
- **13/13 views** existentes e roteadas.
- Nenhuma função JavaScript nomeada duplicada após a correção.
- Todas as stores sincronizadas do frontend possuem mapeamento correspondente no backend.
- Stores críticas confirmadas: products, units, planograms, stock, demandBase, demandCurrent, replenishments, suppliers e supplierOffers.
- IndexedDB contém stores e índices esperados; schema atual permanece na versão 14.
- Integridade ZIP verificada após o empacotamento.

## Performance

Teste sintético da etapa de consolidação/reconciliação Produto × Condomínio com mais de **200 mil relações operacionais** concluiu o merge lógico em aproximadamente **8 ms** no ambiente local de teste. A suíte geral de reconciliação sintética também permaneceu abaixo do limite interno de 1,5 s.

Esse número mede processamento em memória. Ele **não mede** latência de IndexedDB do navegador, internet, Google Apps Script ou Google Sheets. A otimização da V3.38 reduz gravações IndexedDB precisamente para diminuir esse custo no ambiente real.

## Limitações da homologação local

O Chromium headless disponível neste ambiente não concluiu a inicialização da aplicação por limitações do ambiente de execução/DBus. Portanto, não é correto afirmar que câmera física, permissões reais do Chrome, OAuth/Google Drive ou latência real do Apps Script foram homologados aqui.

Esses itens exigem o smoke test pós-publicação:

1. Confirmar topo `v3.38.0` e backend `/exec?action=status` retornando `3.38.0`.
2. Login Admin e teste de senha incorreta.
3. Abrir as 13 views.
4. Sincronizar a Base Central.
5. Em Jomar, Ville de Leon e Luna Bella, conferir que Gestão de Estoque e Contagem Física mostram a mesma lista Produto × Condomínio.
6. Cadastrar EAN teste em dois condomínios, editar e retirar um vínculo.
7. Incrementar estoque no condomínio e confirmar saldo, movimento e vínculo no planograma/Base Mestre.
8. Testar leitura EAN pela câmera física.
9. Gerar Compra Semanal e validar CD → fornecedor.
10. Gerar/aprovar Reposição e confirmar PDF/Drive.
11. Cadastrar fornecedor, marcar produtos atendidos e verificar o filtro pelo fornecedor.
12. Rodar Autoteste e Verificação de Integridade após a sincronização.

## Conclusão

Nenhuma falha conhecida permaneceu nos testes executáveis disponíveis antes do empacotamento. A V3.38 é a versão recomendada para publicação controlada e smoke test com dados reais.
