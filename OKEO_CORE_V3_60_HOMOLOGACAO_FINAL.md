# OKEO V3.60 — Homologação Final

## Correção Produtos por Fornecedor

Ao selecionar um fornecedor, a visão padrão agora é **Produtos deste fornecedor** e mostra somente os produtos cujo fornecedor oficial é o selecionado.

Exemplo: ao selecionar DMULLER, produtos de TAF, AMERICANAS ou outros fornecedores não aparecem mais.

Todos os produtos exibidos em **Produtos deste fornecedor** aparecem marcados.

### Desvinculação
Ao desmarcar um produto:
1. o fornecedor é removido imediatamente;
2. o produto fica **Sem fornecedor**;
3. o produto desaparece da visão do fornecedor atual;
4. passa a aparecer na visão **Sem fornecedor**.

### Nova atribuição
Foi criada a visão **Sem fornecedor**. Nela é possível selecionar um produto livre e vinculá-lo ao fornecedor escolhido. Após a atribuição, ele deixa a lista Sem fornecedor e passa para Produtos deste fornecedor.

A fonte de verdade da tela agora é o vínculo oficial salvo no próprio produto (`supplierId` / `supplier`). Vínculos históricos de `supplierOffers` não fazem outros fornecedores aparecerem indevidamente na lista.

## Validação

- 18/18 verificações funcionais aprovadas;
- sintaxe JavaScript aprovada;
- DMULLER não exibe produtos TAF em simulação;
- desvinculação move o produto para Sem fornecedor;
- atribuição utiliza a regra de fornecedor único;
- regressão de CD, Compras, Contagem Física, validade em modal e aprovação Admin verificada;
- filtro sintético de 300.000 produtos: 7.0 ms.

O backend Apps Script também passou na validação de sintaxe.
