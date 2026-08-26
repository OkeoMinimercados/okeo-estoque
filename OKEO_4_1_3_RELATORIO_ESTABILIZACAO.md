# OKEO 4.1.3 — Estabilização de dispositivos e sincronização

## Objetivo

Resolver em uma única versão os dois últimos cenários observados na homologação:

- computador com alertas `SYNC_AUDIT / VERSION_MISMATCH` já recuperados;
- celular com snapshot desatualizado, 2.104 operações antigas na fila e conflitos locais
  de fornecedor.

## Proteção da Base Central

Um dispositivo com `snapshotEpoch` diferente da Base Central entra automaticamente em
estado **Atualização Central necessária**.

Enquanto estiver nesse estado:

- `processQueue()` NÃO envia a fila antiga;
- escritas operacionais locais são bloqueadas com `DEVICE_REQUIRES_CENTRAL_UPDATE`;
- rotinas automáticas de normalização/sincronização não são iniciadas;
- a Base Central permanece intocada.

Assim, uma fila antiga de celular não pode contaminar a fotografia oficial.

## Atualizar dispositivo pela Central

A atualização segura agora:

1. valida versão frontend/backend;
2. exige Modo Produção e snapshot central válido;
3. informa quantas operações locais antigas existem;
4. baixa **todas** as stores primeiro;
5. valida cada store por quantidade + checksum contra `snapshot_verify`;
6. somente depois da validação salva o estado local anterior em memória;
7. descarta a fila antiga sem enviá-la;
8. substitui as stores locais;
9. executa integridade;
10. grava o `snapshotEpoch` central no dispositivo;
11. em qualquer falha de aplicação, restaura dados e fila anteriores.

Nenhum passo dessa operação escreve na Base Central.

## Conflitos de fornecedor no celular

Os conflitos observados pertenciam ao estado local antigo.

Depois da substituição pelo snapshot central, existe uma normalização **local-only**
que não cria fila nem envia alteração ao servidor. Em seguida as invariantes são
executadas. Se continuarem inconsistentes, a atualização é revertida em vez de liberar
o dispositivo com dados inválidos.

## Alertas de VERSION_MISMATCH recuperados

Quando a versão correta do backend volta a responder, o sistema registra a recuperação.

Erros antigos `SYNC_AUDIT / VERSION_MISMATCH ... backend indisponível` deixam de ser
considerados erros operacionais atuais depois que o backend esperado foi confirmado.
Outros erros continuam visíveis.

## Crescimento normal da operação

Foi mantida a regra de que produtos, fornecedores e unidades são **dados**, não código.

Após o dispositivo estar alinhado ao snapshot central, novos registros seguem pela
sincronização incremental normal. Não é necessária nova versão para:

- adicionar produto;
- adicionar fornecedor;
- adicionar unidade/condomínio;
- vincular produto a fornecedor;
- vincular produto a unidade.

## Testes desta versão

**51/51 verificações aprovadas**, incluindo:

- sintaxe frontend, backend, IndexedDB e Service Worker;
- referências de pacote;
- handlers e rotas;
- bloqueio de fila em dispositivo desatualizado;
- bloqueio de escrita local em snapshot antigo;
- download integral antes de qualquer descarte;
- checksum de snapshot;
- rollback de dados;
- rollback da fila;
- integridade após download;
- atualização de epoch;
- normalização local sem fila;
- resolução de alerta transitório de versão;
- arquitetura snapshot/produção;
- contagem com aprovação;
- fluxo de compra via CD;
- TypeScript checkJs sem identificadores internos inesperados;
- modelo de celular com 2.104 operações antigas: **0 enviadas à Central**;
- modelo de inclusão de novo produto + fornecedor + unidade após alinhamento.

## Snapshot

Não é necessário refazer o snapshot da Base Central existente apenas por esta atualização.
O backend 4.1.3 preserva as propriedades de Produção e o `snapshotEpoch` já criado.
