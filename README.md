# OKEO Core V3.3.1 — Performance Isolado

O módulo operacional de Estoque & Compras foi isolado de Analytics e Financeiro.

## O que entra no Core
Produtos, unidades, fornecedores, estoque, inventário, lotes, validades, compras/NF, movimentações, Ponto de Controle, Demanda operacional, Reposição, vendas necessárias ao saldo/demanda, usuários/perfis, auditoria e integridade.

## Performance
A sincronização foi separada:
- CORE no login;
- SALES apenas em Vendas;
- MOVES apenas em Movimentações;
- PURCHASES apenas em Compras/NF;
- AUDIT apenas em Configurações.

O Dashboard não percorre mais históricos inteiros. Históricos visuais usam índices do IndexedDB e limites de linhas.

## Analytics/Financeiro
Configurações exporta snapshots `OKEO_ANALYTICS_V1` e `OKEO_FINANCE_V1`.
São cópias somente-leitura. Sistemas externos não escrevem em estoque, lotes, movimentações ou compras.

## Instalação
1. Apps Script: `setupOkeoCoreV33`.
2. Atualizar implantação e confirmar `/exec` = 3.3.0.
3. Publicar todo o ZIP.
4. Ctrl+F5.
5. Executar Autoteste e Integridade.

## Hotfix 3.3.1
Corrigida a função `authPost`, necessária para login, criação do primeiro administrador, logout e validação de sessão. O backend 3.3.0 permanece compatível e não precisa ser substituído por causa deste hotfix.
