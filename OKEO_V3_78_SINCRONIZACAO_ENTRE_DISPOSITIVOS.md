# OKEO V3.78 — Sincronização entre dispositivos

## Causa
A Base Central de autenticação foi recriada/corrigida, porém os dados operacionais
já existentes no computador não eram automaticamente enviados para ela.

O sincronizador normal envia alterações novas pela `syncQueue`. Uma base antiga
que já existia no IndexedDB do computador não entra nessa fila apenas por existir.

Resultado:
- computador mantinha a base local completa;
- celular autenticava corretamente;
- Base Central possuía poucos ou nenhum registro operacional;
- celular exibia 0 produtos/estoque.

## Correção
Configurações ganhou **Sincronização entre dispositivos**:

### Diagnosticar Local × Central
Compara quantidade de registros por store.

### Publicar esta base local na Base Central
Usar no computador que contém a base correta.
- exporta backup antes;
- publica todos os stores em blocos;
- usa upsert: não apaga registros centrais;
- atualiza registros com mesmo ID e adiciona ausentes.

### Baixar Base Central neste dispositivo
Usar no celular ou dispositivo secundário.
- baixa cada store integralmente;
- só substitui uma store local depois de receber resposta válida;
- limpa fila local antiga após conclusão.

### Hidratação automática
Um dispositivo novo com quase nenhum produto passa a baixar automaticamente a
Base Central quando detectar que o Central já possui uma base completa.

## Segurança operacional
A publicação inicial exige Administrador e confirmação digitando `PUBLICAR`.
Um dispositivo sem produtos não pode ser usado como origem.

## Validação
13/13 verificações aprovadas.
