# OKEO V3.79 — Correção do botão Sincronizar agora

## Problemas encontrados

1. `syncNow` dependia do bind geral do sistema. Se um controle anterior inexistente
causasse exceção, o botão ficava sem evento.

2. O comando antigo chamava apenas `syncAll()`, que sincroniza alterações/deltas.
Uma base histórica que já estava no IndexedDB do computador não é automaticamente
colocada na fila só por existir.

## Correção

- botão possui fallback direto `onclick="syncNowSafe()"`;
- botão também é ligado pelo bind crítico, antes do bind geral;
- Diagnosticar, Publicar e Baixar também possuem fallback direto;
- `syncNowSafe()` mostra progresso 1/4 a 4/4;
- antes de sincronizar, compara Local × Central;
- se detectar computador com base completa e Central vazia/incompleta, oferece
  iniciar a publicação inicial;
- depois envia fila, baixa deltas e compara as bases novamente;
- nenhuma falha fica silenciosa: `syncMsg` recebe sucesso ou erro.

## Validação
13/13 verificações aprovadas.
