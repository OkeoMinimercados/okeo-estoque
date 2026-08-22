# OKEO Estoque V2.0 — Fluxo Operacional

Fluxo oficial:
Vendas -> Demanda -> Rascunho editável -> Aprovação -> PDF registrado -> NF/transferência confirmada -> Estoque -> Validades -> Ponto de Controle.

Regras principais:
- Frequência define somente quando a unidade entra na rota.
- Estoque Ideal = 100% da demanda média semanal; Nível de Alerta = 50%.
- CD é a primeira origem automática.
- Transferência entre condomínios nunca é automática; o usuário pode escolher manualmente no rascunho.
- Fornecedor final pode ser alterado/digitado manualmente.
- PDF aprovado vira registro de reposição, mas não altera estoque sozinho.
- Validade não bloqueia movimentação; até 7 dias aparece como alerta no relatório.
- Ponto de Controle pode ser feito a qualquer momento e só sobrescreve o saldo após aprovação.
