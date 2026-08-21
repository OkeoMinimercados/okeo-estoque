# OKEO Estoque V1.2 — Turbo Sync

Otimização principal:
- Sincronização em lote: 1 chamada ao Apps Script para enviar a fila e receber todos os dados.
- Substitui várias requisições sequenciais da V1.1.
- Mantém fila offline e IndexedDB local.
- Sincronização automática limitada para não recarregar a Base Central a cada abertura.
- Tela mostra o tempo gasto no Sync.

Escopo permanece: estoque, validades, movimentações, grupos e demanda inteligente.
VM Pay continua preparada no backend e desativada até a API estar disponível.
