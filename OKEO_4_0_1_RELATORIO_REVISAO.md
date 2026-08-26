# OKEO 4.0.1 — Revisão ampliada de acessibilidade operacional

## Motivo
Na 4.0.0 a seção **Saúde do Sistema** existia no HTML e suas funções estavam implementadas,
mas ficava no fim da tela de Configurações e não possuía acesso direto no menu. A suíte anterior
validava existência e handlers, mas não validava **descobribilidade/acesso visual da função**.

## Correção
- criado item **✓ Saúde do Sistema** no menu lateral do Administrador;
- o item abre Configurações e rola diretamente até a área;
- a área Saúde recebeu contorno próprio e destaque ao ser aberta;
- elementos `.admin-only` agora são aplicados globalmente conforme o perfil, e não apenas no painel de usuários;
- Saúde continua exclusiva do Administrador;
- revisão rápida agora verifica também se as ferramentas administrativas essenciais estão acessíveis.

## Ferramentas administrativas verificadas
- Saúde do Sistema;
- Revisão rápida;
- Autoteste;
- Integridade;
- Reset Geral;
- Diagnóstico Local × Central;
- Espelhamento para Base Central;
- Download da Base Central;
- Diagnóstico de autenticação.

## Regressão
A suíte ampliada `OKEO_4_0_1_REGRESSION.py` foi incorporada ao pacote. Ela passou integralmente
após a correção e deve ser executada em futuras versões.

Além disso, continuam presentes as verificações e correções da 4.0.0 para:
- aprovação da contagem física;
- fornecedor exclusivo por produto;
- Conferência e Validade;
- reserva e despacho via CD;
- abastecimento;
- captura de erros;
- timeout da Base Central;
- isolamento de falhas por tela.

## Versão
Frontend: **4.0.1**
Backend: **4.0.1**
Cache/PWA: **okeo-core-v4-0-1**

Esta revisão corrige especificamente a lacuna que permitiu uma função existir no código,
mas não estar facilmente acessível para o usuário.
