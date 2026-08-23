# OKEO Core V3.33 — Validação

Data: 23/08/2026

## Resultado
**APROVADO PARA IMPLANTAÇÃO CONTROLADA.**

## Melhorias implementadas
- Compras passa a abrir com **Planejamento de Compra Semanal**.
- Horizonte padrão de compra: **7 dias**, compatível com fornecedores que entregam 1x por semana.
- Reposição imediata e compra semanal passam a ser cálculos distintos.
- Compra mínima para evitar ruptura: `demanda do período - estoque projetado - CD disponível`.
- Compra recomendada: `demanda do período + alerta - estoque projetado - CD disponível`.
- Estoque projetado considera estoque atual + reposições aprovadas/em andamento, evitando dupla compra.
- O **CD tem prioridade**: a quantidade disponível no CD é alocada antes da compra externa.
- Produtos com status atual **OK / Não precisa reposição** podem aparecer como **compra preventiva** quando não têm cobertura até a próxima entrega.
- Relatório **por condomínio**.
- Relatório **consolidado por produto e fornecedor**.
- Filtros por condomínio, fornecedor, produto/EAN e horizonte de cobertura.
- Exportação CSV compatível com Excel.
- Compras ganhou aba interna **Reposição Operacional**, com resumo de pendências do CD e compras externas e acesso ao checklist completo existente.
- Sincronização da tela Compras ampliada para produtos, unidades, planogramas, estoque, demanda, reposições, lotes, fornecedores, ofertas e compras.

## Exemplo de regra validado
Coca-Cola 2L:
- Estoque atual: 10 un.
- Média semanal: 40 un.
- Alerta: 4 un.
- Horizonte: 7 dias.
- CD disponível: 0 un.

Resultado:
- Demanda projetada: 40 un.
- **Compra mínima para evitar ruptura: 30 un.**
- **Compra recomendada com segurança: 34 un.**

Assim, mesmo que a reposição imediata esteja em status **Não precisa**, o produto entra na compra semanal preventiva.

## Testes executados
- Sintaxe JavaScript: APROVADA (`node --check`).
- Referência de versão HTML/JS V3.33: APROVADA.
- Painel semanal: APROVADO.
- Relatório por condomínio: APROVADO.
- Consolidado por produto: APROVADO.
- Reposição incorporada ao módulo Compras: APROVADA.
- Prioridade CD → fornecedor: APROVADA.
- Compra preventiva para status OK: APROVADA.
- Sincronização COMMERCE: APROVADA.
- Exportação semanal: APROVADA.
- Média semanal integrada ao contexto operacional: APROVADA.
- Fórmula do exemplo mínimo 30 / recomendado 34: APROVADA.
- IDs HTML duplicados: 0.

**14/14 verificações aprovadas.**

## Backend
Nenhuma alteração de contrato do backend foi necessária. O Apps Script da V3.32 permanece compatível e é incluído no pacote de implantação renomeado como backend sem alteração.
