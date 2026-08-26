# OKEO 4.1.1 — Patch final da Saúde do Sistema

Esta versão não altera fluxos operacionais, estoque, compras, contagens ou o snapshot
já concluído. Ela corrige somente o diagnóstico pós-produção.

## Correções

- remove o teste legado “Correção Local → Central”;
- após Modo Produção ativo, a Saúde não faz nova leitura pesada de todas as stores
  centrais;
- valida a sincronização pelo snapshotEpoch do dispositivo × snapshotEpoch central;
- evita TIMEOUT_BASE_CENTRAL provocado pela própria revisão;
- erros anteriores ao snapshot/download atual passam a ser históricos;
- snapshot ou download bem-sucedido estabelece uma nova linha de base de erros;
- uma falha histórica REPAIR_CENTRAL / TIMEOUT_BASE_CENTRAL não reprova a Saúde atual.

## Importante

O snapshot 4.1 já concluído permanece válido. Não execute novamente
“Preparar Base Central para Produção” apenas por causa deste patch.

Após publicar frontend e backend 4.1.1:
1. atualizar/reabrir a aplicação;
2. abrir Saúde do Sistema;
3. executar Revisão rápida;
4. confirmar Backend 4.1.1, Modo Produção ativo e Snapshot do dispositivo alinhado;
5. se tudo estiver verde, atualizar um celular pela Base Central;
6. testar login, abertura das telas e uma operação controlada de leitura no celular.

Esta é a última revisão técnica recomendada antes de congelar a linha 4.1 para produção.
