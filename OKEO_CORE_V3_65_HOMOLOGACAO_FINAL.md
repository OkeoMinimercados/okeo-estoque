# OKEO V3.65 — Demanda Inteligente como Entrada e Consulta

A aba foi reorganizada para não executar cálculo pesado durante o uso operacional.

## Nova estrutura
1. Entrada da Base de Demanda Processada
2. Controle da Base Ativa
3. Consulta da Demanda Calculada
4. Processamento Externo

## Entrada
Aceita arquivo processado em JSON, CSV ou XLSX.

Campos principais:
- unidade
- EAN/produto
- média semanal
- pico semanal
- nível de alerta
- estoque ideal
- status
- período-base

## Operação
A importação substitui `demandCurrent` por uma base já calculada e pronta para uso.

A consulta apenas lê `demandCurrent`; não recalcula histórico dentro da tela.

## Integração
Os demais módulos continuam consumindo a mesma base `demandCurrent`, preservando a integração com Reposição, Compras e Gestão de Estoque.

## Homologação
12/12 verificações aprovadas.
