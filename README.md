# OKEO Estoque V1.1 — Sincronização

Esta versão mantém IndexedDB local para operação rápida/offline e sincroniza com a Base Central quando houver conexão.

Sincronizados:
- Produtos
- Condomínios/CD
- Estoque
- Validades (metadados; foto permanece local nesta versão)
- Movimentações
- Grupos de demanda
- Resumos semanais de vendas
- Histórico de importações

A fila local garante que uma indisponibilidade da Base Central não bloqueie a operação.

VM Pay permanece preparada no Apps Script e desativada até a documentação/credenciais.
