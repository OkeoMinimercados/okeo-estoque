# OKEO Core V3.39 — Homologação e correção final

**Resultado estático/regressão: 26/26 verificações aprovadas.**

- APROVADO — JS sintaxe
- APROVADO — HTML IDs únicos
- APROVADO — Versão HTML 3.39
- APROVADO — Service Worker 3.39
- APROVADO — Recarga integral crítica
- APROVADO — Marcador migração 3.39
- APROVADO — Carga antes da primeira view
- APROVADO — Saldo zero mantém vínculo
- APROVADO — CD usa Base Mestre
- APROVADO — Recuperação Contagem zero
- APROVADO — Recuperação Gestão zero
- APROVADO — Checklist cadastro produto recarrega
- APROVADO — Checklist compra condomínios
- APROVADO — Checklist compra fornecedores
- APROVADO — Reconciliação fornecedores
- APROVADO — Fornecedor novo seleciona produtos
- APROVADO — Filtro fornecedor produtos
- APROVADO — CD em tabela
- APROVADO — Incremento garante vínculo
- APROVADO — Backend versão 3.39
- APROVADO — Backend planograms gravável
- APROVADO — Backend mapeia Planogramas
- APROVADO — Backend mapeia Fornecedores
- APROVADO — Sintaxe app-v3.39.0.js
- APROVADO — Sintaxe db.js
- APROVADO — Sintaxe sw.js

## Falha raiz corrigida
O cursor incremental era mantido por escopo. Quando stores novas (como Planogramas e Fornecedores) passaram a integrar o Core, instalações já sincronizadas podiam não receber os registros históricos dessas stores. A V3.39 executa recarga integral das bases críticas na migração e recuperação automática quando uma unidade retorna vazia.

## Correções adicionais
- Estoque com quantidade 0 continua compondo o cadastro Produto × Condomínio.
- Catálogo de fornecedores é reconciliado por múltiplas fontes.
- Cadastro de fornecedor permite vincular produtos da Base Mestre no mesmo fluxo.
- Movimentação de Estoque CD usa tabela por colunas.
- Backend autoriza persistência de Planogramas para fluxos operacionais permitidos.

## Limitação
Câmera física, permissões do navegador e latência real do Apps Script/Google Drive precisam de smoke test após publicação.