# OKEO Gestão 5.0 Stable — Relatório final de estabilização

## Por que esta versão é diferente

As builds 4.1.x corrigiam sintomas individualmente. A 5.0 Stable substitui esse
método por regras estruturais que impedem os mesmos estados conflitantes de voltar.

### 1. Base Central única

O frontend contém uma única implantação oficial (`...IJQBAutw`).
Não existe referência ao deployment antigo `...0fuWgqjrcvgq`.
A URL não pode mais ser alterada por localStorage, IndexedDB, sessão ou campo de
configuração.

### 2. Máquina de estados operacional

O dispositivo só pode estar em:
- BOOT
- LOGIN_REQUIRED
- CONNECTING
- PREPRODUCTION
- NEEDS_HYDRATION
- READY
- OFFLINE
- ERROR

Escritas e sincronização só são permitidas nos estados apropriados.

### 3. Sessão isolada por backend

Tokens persistidos carregam a URL/deployment que os emitiu.
Sessões antigas de outra Central são descartadas antes do auto-login.
Isso elimina o ciclo de entrar/sair causado por tokens de outra implantação.

### 4. Snapshot por backend

O snapshot local não é mais global ao navegador.
Cada deployment possui seu próprio `snapshotEpoch` local.
Trocar de backend não pode fazer um snapshot antigo parecer alinhado.

### 5. Fila por backend

Cada operação pendente carrega o identificador da Central de origem.
Registros de versões antigas sem identificação entram em `LEGACY_UNASSIGNED`.
Eles ficam em quarentena e nunca são enviados automaticamente.

### 6. Sincronização centralizada

Foi removida a sincronização independente ao abrir telas.
Foi removida a hidratação automática.
Existe um único coordenador de sincronização com lock:
- confirma estado READY;
- envia apenas a fila da Central atual;
- opcionalmente puxa o Core;
- não cria ciclos concorrentes.

### 7. Upgrade de navegador antigo

A inicialização da 5.0:
- força a Central oficial;
- ignora configuração de backend antiga;
- coloca filas legadas em quarentena;
- rejeita sessão emitida por outra Central;
- ignora snapshot global antigo;
- Service Worker remove caches OKEO anteriores.

### 8. Crescimento sem código

Produto, fornecedor e unidade são registros de dados.
A inclusão de novos itens não exige uma nova release.

## Baterias executadas

### Auditoria estrutural ampliada
Foram verificadas sintaxe, arquivos, DOM, handlers, rotas, fonte única de backend,
máquina de estados, snapshot, fila, sessão, sincronização, saúde, compras, CD,
contagem, fornecedor exclusivo, backup/rollback e versionamento.

A única expectativa inicialmente reprovada era um teste que exigia o seed também no
HTML; a arquitetura correta o carrega pelo pacote/cache. O teste foi corrigido.

### Suíte incorporada ao pacote
`OKEO_5_STABLE_REGRESSION.py`: **64/64 aprovada**.

### Stress independente de estados
**50.000 combinações aleatórias** de produção, sessão, conectividade, snapshot e
origem da fila: **0 violações** de envio em estado incorreto ou para backend errado.

### Crescimento
Modelo de crescimento adicionou 10.000 registros distribuídos entre produtos,
fornecedores e unidades sem mudança de código.

### Desempenho sintético de snapshot
- 1.245 produtos: ~0,09 MB
- 10.000 produtos: ~0,74 MB
- 50.000 produtos: ~3,78 MB
- 100.000 produtos: ~7,59 MB
Serialização e checksum locais ficaram abaixo de 0,1 s no ensaio de 100 mil registros.

## O que ainda depende do ambiente publicado

Nenhuma análise offline consegue provar a disponibilidade futura do Google Apps Script,
rede móvel ou navegador. Por isso a publicação final ainda precisa de uma única
aceitação no ambiente real. Essa aceitação não deve ser usada para desenvolvimento
incremental: se houver um bloqueio, a release é tratada como não aprovada.

## Política após homologação

A linha 5.0 Stable deve ser congelada.
Novas funcionalidades entram em uma linha separada e só substituem a produção depois
de passar novamente pela regressão.
