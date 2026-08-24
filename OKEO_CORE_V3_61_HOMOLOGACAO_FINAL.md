# OKEO V3.61 — Homologação Geral dos Filtros

## Problemas corrigidos

### Compra Semanal — Condomínios e Fornecedores
Foi corrigida uma falha de lógica importante:

Antes, quando a seleção era esvaziada pelo botão **Limpar**, o sistema interpretava o conjunto vazio como **Todos** e voltava a incluir todos os condomínios/fornecedores.

Agora:
- `Todos` significa todos efetivamente marcados;
- `Limpar` significa **nenhum selecionado**;
- nenhum selecionado retorna zero itens;
- seleção parcial aplica somente os condomínios/fornecedores marcados;
- pesquisa dentro do checklist filtra as opções disponíveis;
- pesquisa de produto filtra o relatório final;
- os resumos mostram `X de Y` quando a seleção é parcial;
- filtros ativos recebem destaque visual.

### Contagem Física
A pesquisa de produtos foi revisada e ligada por dois caminhos:
- roteador universal de filtros;
- fallback direto `oninput`.

Pesquisa por:
- nome;
- EAN;
- alias;
- nome VM Pay;
- fornecedor;
- segmento.

### Produtos por fornecedor
O filtro passou a reconciliar fornecedor tanto por:
- `supplierId`; quanto por
- nome normalizado do fornecedor.

Isso corrige bases antigas que possuem somente o nome e bases novas que possuem ID.

### Planograma
Corrigido o roteamento da pesquisa: o filtro chamava uma função incorreta. Agora chama diretamente `renderPlanogramList()`.

### Demanda
Corrigido o filtro de unidade que estava apontando para uma função inexistente. Agora usa `calcDemand()`.

### Roteador único de filtros
Foi criado um roteador delegado único para `input` e `change`, portanto os filtros continuam funcionando mesmo em abas que são abertas posteriormente ou possuem conteúdo dinâmico.

Foram auditados:
- Base Mestre;
- Planograma;
- Produtos por fornecedor;
- Cadastro de fornecedor;
- Contagem Física;
- Compra Semanal;
- Conferência e abastecimento;
- Movimentação de Estoque CD;
- Validades;
- Grupos;
- Análise de divergências;
- Gestão de Estoque por condomínio;
- Demanda.

## Homologação

**79/79 verificações aprovadas.**

Incluídos testes ponta a ponta de:
- todos os condomínios e fornecedores;
- limpar condomínio = zero resultados;
- filtro combinado condomínio + fornecedor;
- pesquisa de produto;
- pesquisa física por nome;
- pesquisa física por EAN;
- pesquisa física por fornecedor;
- existência das funções chamadas pelos filtros.

## Performance

Filtro combinado sintético sobre 300.000 registros:
**~9 ms de mediana**.

Frontend, Service Worker e backend Apps Script passaram na validação de sintaxe.
