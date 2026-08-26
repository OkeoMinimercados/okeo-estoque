# OKEO 4.1 Final — Relatório de estabilização e homologação técnica

## Objetivo

A 4.1 foi criada para encerrar o ciclo de correções pontuais e transformar o sistema
em uma base de produção mais previsível.

## Arquitetura de sincronização

A migração inicial por centenas de requisições foi substituída por **snapshot por store**.

Fluxo:

1. computador fonte gera backup;
2. envia uma fotografia completa de cada store;
3. backend substitui a store com uma única gravação em lote;
4. frontend e backend calculam quantidade + checksum dos IDs;
5. somente após todas as stores conferirem é executado `snapshot_finalize`;
6. backend grava um `snapshotEpoch` e ativa **Modo Produção**;
7. demais dispositivos baixam a fotografia central.

Isso separa:
- implantação inicial: snapshot;
- operação diária: sincronização incremental/deltas.

## Fonte oficial dos dados

Depois do Modo Produção, a **Base Central é a autoridade compartilhada**.
IndexedDB é a cópia local/offline do dispositivo.

Cada dispositivo armazena o `snapshotEpoch` recebido.
Se estiver diferente da Central, operações de escrita são bloqueadas com
`SNAPSHOT_OUTDATED` até o dispositivo ser atualizado.

## Compatibilidade de versão

Frontend 4.1.0 exige backend 4.1.0.

Escritas são bloqueadas quando existe divergência de versão, evitando que uma versão
nova grave dados em um backend antigo.

## Migrações de dados

Foi criado `DATA_SCHEMA_VERSION=410` e `runDataMigrations()`.

A migração atual normaliza itens de compra via CD de versões anteriores e adiciona
identificadores de operação aos itens legados.

## Invariantes operacionais

A Saúde do Sistema verifica automaticamente, entre outros:

- mais de um fornecedor ativo para o mesmo produto;
- estoque negativo;
- estoque/lotes ligados a produto ou unidade inexistente;
- lote negativo;
- contagem pendente marcada como aprovada;
- compra via CD abastecida sem despacho;
- quantidade de validades diferente da quantidade recebida.

## Backup, restauração e rollback

O backup foi atualizado para 4.1.

A restauração:
- valida o arquivo completo antes de alterar dados;
- gera um novo backup do estado atual antes de restaurar;
- carrega todos os stores;
- se qualquer store falhar, executa rollback lógico para o estado anterior;
- não altera automaticamente a Base Central.

## Pré-checagem ao iniciar

Depois do login o sistema verifica:
- versão frontend/backend;
- migrações;
- erros técnicos recentes;
- tamanho da fila pendente;
- snapshot do dispositivo × snapshot central;
- condição básica da base local.

Problemas são exibidos em um banner e direcionam para Saúde do Sistema.

## Produção

A área Saúde do Sistema possui **Preparar Base Central para Produção**.

Essa operação exige:
- Administrador;
- frontend/backend 4.1.0;
- base local com catálogo, fornecedores e vínculos;
- confirmação explícita `PRODUCAO`;
- backup;
- validação store por store;
- validação global antes de ativar Produção.

## Fluxos críticos preservados

### Contagem física
Operacional finaliza → PENDING_APPROVAL → Administrador aprova → estoque é atualizado.

### Compra imediata
Conferência → Validade → Liberado → Abastecimento → Estoque do condomínio.

### Compra via CD
Conferência → Validade → READY_CD → Reservado no CD → Despacho →
Liberado → Abastecimento → Estoque do condomínio.

## Testes

Foram executadas duas camadas:

### Auditoria ampliada desta geração
**82/82 verificações aprovadas**, cobrindo:
- sintaxe;
- arquivos/cache;
- HTML/handlers;
- rotas;
- endpoints;
- versionamento;
- snapshot;
- checksum;
- compatibilidade;
- epoch;
- migração;
- invariantes;
- backup/restauração/rollback;
- contagem;
- compra imediata/CD;
- captura de erros;
- Saúde;
- TypeScript checkJs sem identificadores internos inesperados;
- modelos E2E dos fluxos críticos.

### Suíte incorporada ao pacote
`OKEO_4_1_FINAL_REGRESSION.py` também passou integralmente e deve ser executada
novamente antes de qualquer release futura.

## Teste sintético de payload de snapshot

Com registros sintéticos semelhantes a produtos:
- 1.245 registros: ~0,15 MB;
- 5.000 registros: ~0,62 MB;
- 20.000 registros: ~2,51 MB.

O snapshot reduz fortemente o número de round-trips em comparação com a migração
antiga por blocos. Esses números são de serialização local, não de latência real
do Apps Script.

## Limite técnico

Nenhum software pode ser garantido como literalmente livre de qualquer bug futuro.
Câmera real, rede móvel, navegador/PWA e disponibilidade do Apps Script dependem do
ambiente de produção.

A diferença na 4.1 é que os principais modos de falha agora são bloqueados, detectados
ou registrados antes de corromper/sobrescrever silenciosamente os dados.

## Política recomendada

Congelar a 4.1.0 após a preparação da Base Central.
Novas funcionalidades devem entrar em uma futura linha 4.2/5.x e só serem promovidas
quando a regressão voltar a passar integralmente.
