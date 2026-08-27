# OKEO Gestão 5.3 Stable — estabilização do transporte

## Problema que permanecia na 5.2

A 5.2 dependia de um Web App do Google Apps Script executando dentro de um iframe oculto.
No ambiente real o iframe não chegava ao estado `ready`; por isso status e login ficavam
aguardando até o timeout.

## Correção estrutural desta release

A 5.3 elimina o iframe e também não usa `fetch` normal dependente de CORS.

A comunicação agora é dividida em dois canais simples:

- **Leituras**: JSONP por `<script src>`.
- **Escritas e autenticação**: POST `no-cors` com `application/x-www-form-urlencoded`.
  A resposta operacional é guardada temporariamente pelo backend e recuperada pelo
  frontend com JSONP usando `requestId + secret`.

A senha de login é enviada somente no corpo POST. Ela não aparece na URL JSONP.

## Proteções mantidas

- Uma única Base Central oficial: deployment `...IJQBAutw`.
- Máquina de estados operacional.
- Sessão vinculada ao backend.
- Snapshot por backend.
- Fila por backend.
- Operações antigas em quarentena.
- Um único coordenador de sincronização.
- Hidratação automática desativada.
- Rollback de atualização de dispositivo e restauração de backup.
- Crescimento de produtos, fornecedores e unidades sem alteração de código.

## Testes executados

### Regressão do pacote
**69/69 verificações aprovadas**:
sintaxe, arquivos, DOM, handlers, backend único, transporte, máquina de estados,
fila, snapshot, sessão, automatismos, autenticação, compras, CD, contagem,
fornecedor exclusivo, rollback, rotas e versões.

### Stress de estados
**100.000 combinações** de sessão, conectividade, produção, snapshot e origem
de fila: **0 violações** de envio indevido.

### Teste de navegador do novo transporte
Executado em Chromium headless com duas origens diferentes simuladas:

- status por JSONP;
- login por POST `no-cors`;
- `validate_session`;
- leitura de **50.000 produtos**;
- **100 escritas concorrentes**;
- resposta lenta;
- erro de validação do servidor;
- timeout proposital e chamada seguinte funcionando;
- limpeza dos callbacks JSONP;
- senha confirmada no POST e ausente das URLs GET.

Todos os cenários passaram.

## Importante

Nenhum teste local consegue substituir a última confirmação da implantação real do
Google Apps Script. Por isso esta release deve ser publicada uma única vez e o primeiro
critério de homologação é: status online + login concluído. Não preparar snapshot antes
desse ponto.
