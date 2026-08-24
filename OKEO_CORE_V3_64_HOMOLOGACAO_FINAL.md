# OKEO V3.64 — Controle de Atualização da Demanda

## Nova área de controle
A tela de Demanda agora possui um painel persistente **Controle de atualização** com:
- Status atual: Atualizado / Atualização pendente / Atualizando / Erro / Sem base;
- arquivos selecionados;
- quantidade de registros da Base Histórica;
- quantidade de registros da Demanda Operacional;
- última importação;
- último cálculo;
- período do último cálculo;
- período atualmente selecionado;
- visão calculada;
- duração do último cálculo.

## Regras de atualização
- selecionar novos arquivos → status passa para **Atualização pendente**;
- alterar período → **Atualização pendente**;
- alterar visão → **Atualização pendente**;
- iniciar importação/cálculo → **Atualizando**;
- concluir → **Atualizado**;
- falha → **Erro na atualização**.

## Controles
- **Atualizar status**: relê o estado real das bases;
- **Recalcular agora**: recalcula usando a Base Histórica já carregada;
- **Importar e calcular demanda**: incorpora os arquivos selecionados e recalcula.

## Correção de mensagem
A mensagem “Nenhum snapshot processado” não é mais exibida quando existem registros locais em `demandBase`. Nesse caso o sistema informa quantos registros históricos existem, mesmo se o metadado de importação estiver ausente.

## Homologação
18/18 verificações aprovadas.
Frontend, Service Worker e backend Apps Script passaram na validação de sintaxe.
