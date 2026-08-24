# OKEO V3.57 — Homologação dos filtros do CD

## Correção
A aba **Movimentação de Estoque CD → Pré-Separado em Compras** foi corrigida.

A causa era que os selects de Fornecedor e Condomínio eram reconstruídos somente com base nos itens já presentes na lista de pré-separados. Quando a lista estava vazia, ou quando determinados fornecedores/condomínios não tinham itens naquele momento, os filtros ficavam apenas em “Todos” e pareciam não funcionar.

## Novo comportamento
- Fornecedor é preenchido com todos os fornecedores ativos da Base Mestre + fornecedores presentes nas mercadorias.
- Condomínio é preenchido com todos os condomínios ativos da Base Mestre + unidades presentes nas mercadorias.
- Status filtra diretamente o status operacional real.
- Pesquisa considera produto, EAN, fornecedor, condomínio, origem da compra e descrição do status.
- Os valores selecionados são preservados durante a atualização da lista.
- Fornecedor usa comparação normalizada para evitar falhas por acentos/maiúsculas.
- Foi incluído botão **Limpar filtros**.
- O resumo passa a mostrar “X de Y itens”.
- Todos os quatro campos possuem acionamento direto (`change`/`input`) além da camada geral de handlers.

## Testes
**19/19 verificações aprovadas.**

Foram validados:
- fornecedor isolado;
- condomínio isolado;
- status isolado;
- pesquisa textual;
- filtros combinados;
- cenário sem resultados;
- preservação da seleção;
- opções disponíveis mesmo sem mercadorias;
- sintaxe JS e Service Worker.

Performance sintética de filtragem em 300.000 registros: aproximadamente **11 ms**.

## Publicação
Publique o ZIP V3.57 completo para que `index.html`, `app-v3.57.0.js` e `sw.js` sejam atualizados juntos.
