# OKEO V3.52 — Homologação Final

## Alterações desta versão

- O bloco separado “Destino após a compra” foi removido.
- O destino passou a ser definido diretamente em cada linha Produto × Condomínio da Compra Semanal.
- A coluna Destino possui ação “Selecionar todos”, permitindo marcar todos os itens visíveis como Abastecimento imediato ou Pré-Separado no CD.
- A coluna Incluir também possui seleção de todos os itens visíveis.
- A tela Movimentação de Estoque CD foi separada em **Estoque** e **Pré-Separado em Compras**.
- Corrigido o container da lista de pré-separados: a função agora renderiza em `cdInboundList`.
- Filtros de fornecedor, condomínio, status e pesquisa da lista Pré-Separado em Compras foram ligados à lista real.
- A tela de Validades passou a aceitar até 3 validades/lotes no mesmo lançamento.
- “Ver produtos” em Fornecedores agora seleciona o fornecedor, abre a lista, renderiza os produtos e rola até o painel.
- Todas as telas principais recebem o botão **Limpar histórico/testes** para administrador. A limpeza não remove Base Mestre, unidades, fornecedores, planogramas ou saldo atual de estoque.
- Aumentado o espaçamento vertical de tabelas e listas.

## Validação

Foram executadas **51/51 verificações aprovadas**, cobrindo:
- sintaxe JavaScript;
- IDs HTML;
- Service Worker V3.52;
- destino por linha e seleção em massa;
- persistência do destino no item comprado;
- abas e filtros do CD;
- terceira validade;
- fornecedor único e abertura da lista de produtos;
- limpeza sincronizada de históricos de teste;
- pesquisas críticas dos módulos;
- ausência de handlers órfãos não protegidos;
- simulação de seleção em massa e filtros combinados do CD.

O backend Apps Script também passou na verificação de sintaxe.

## Limitação de homologação

O ambiente local valida código, estrutura e regras, mas não substitui o teste do PWA publicado. Após publicar V3.52, faça um ciclo com compra semanal de teste, marque alguns itens como CD, feche a compra, abra Pré-Separado em Compras, teste os quatro filtros, registre 3 validades em um produto e confirme a abertura de “Ver produtos” em um fornecedor.
