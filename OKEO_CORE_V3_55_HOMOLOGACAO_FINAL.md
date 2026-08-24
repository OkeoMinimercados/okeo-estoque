# OKEO V3.57 — Homologação Final

## Correções implementadas

### Compra Semanal
Foram conferidos os quatro botões principais:
- Gerar / atualizar compra semanal;
- Visão por condomínio;
- Consolidado por produto;
- Exportar para Excel (CSV).

Além dos handlers normais, os botões possuem acionamento direto de fallback para evitar falha silenciosa de clique.

### Produtos por fornecedor
Foi encontrada uma falha real na V3.54: `renderSupplierProductList()` e `supplierVisibleProducts()` eram chamadas pela tela, porém suas implementações não estavam presentes no pacote final. As funções foram restauradas.

A tela agora:
- seleciona o fornecedor;
- carrega os produtos cujo fornecedor principal é o selecionado;
- considera a compatibilidade de vínculos antigos;
- mostra quantidade de produtos vinculados;
- permite pesquisar, selecionar/desmarcar e salvar;
- mantém a regra de um único fornecedor ativo por produto.

### Conferência e abastecimento
Os filtros de Condomínio e Fornecedor agora são populados pela Base Mestre de unidades/fornecedores ativos, mesmo quando ainda não existem mercadorias no status selecionado. Os filtros de Fluxo e Status continuam disponíveis e todos usam `change` e `input` como handlers.

### Validade integrada à Contagem Física
Cada produto da Contagem Física agora possui **Registrar validade**.

O fluxo permite:
- uma validade; ou
- marcar **Produto tem dupla validade**, abrindo dois registros.

Para dupla validade:
- Qtd. 1 + Qtd. 2 = Contagem final;
- o campo de contagem fica calculado automaticamente;
- antes de finalizar, o sistema valida que as duas quantidades somam exatamente a contagem;
- cada validade pode ter seu próprio lote.

O perfil operacional continua apenas enviando a contagem para aprovação. As validades ficam anexadas ao item da contagem e não alteram estoque antes da aprovação.

Na aprovação pelo Administrador:
- a contagem observada atualiza o estoque;
- os lotes/validades informados substituem a posição de validade daquele produto/unidade;
- cada validade é gravada na base `expiries`;
- os dados passam a aparecer no Relatório/Análise de Validades.

## Testes

Validação estrutural: **32/32 verificações aprovadas**.

Teste de fluxo e performance: **10/10 verificações aprovadas**.

### Fluxo ponta a ponta testado
Estoque esperado 10 → validade 1 = 7 unidades → validade 2 = 5 unidades → contagem final = 12 → perfil operacional finaliza → estoque permanece 10 → Administrador aprova → estoque passa a 12 → duas validades ficam disponíveis para a análise de validades.

### Performance
Filtro sintético com 300.000 registros: aproximadamente **20 ms** de mediana.

Frontend, backend Apps Script e Service Worker passaram na validação de sintaxe. Os pacotes ZIP passaram na verificação de integridade.

## Teste publicado recomendado
Após publicar V3.57, validar em navegador:
1. os quatro botões da Compra Semanal;
2. `Ver produtos` em AMBEV e outro fornecedor;
3. abrir Conferência e abastecimento e verificar as listas de Condomínio/Fornecedor mesmo sem mercadorias;
4. contar um produto com duas validades;
5. finalizar com perfil operacional;
6. aprovar com Administrador;
7. confirmar as duas datas no módulo Validades.
