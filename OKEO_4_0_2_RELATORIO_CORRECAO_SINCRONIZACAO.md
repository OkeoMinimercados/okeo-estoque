# OKEO 4.0.2 — Correção guiada de sincronização

## Diagnóstico que motivou a versão
A Saúde do Sistema encontrou:
- Backend publicado 4.0.0 enquanto o frontend já estava atualizado;
- Produtos: Local 1.245 × Central 0;
- Unidades: Local 8 × Central 9;
- Fornecedores: Local 25 × Central 0;
- Produtos × fornecedor: Local 1.245 × Central 0;
- Contagens: Local 1 × Central 0.

## Correções
Foi criada a função **Corrigir sincronização Local → Central**, exclusiva do Administrador.

Ela:
1. exige backend 4.0.2 publicado;
2. confere se o dispositivo realmente parece ser a fonte completa;
3. apresenta as divergências antes de executar;
4. exige confirmação digitando `CORRIGIR`;
5. gera backup;
6. publica todos os stores locais em blocos;
7. remove da Base Central registros operacionais extras inexistentes localmente;
8. limpa fila/cursors antigos;
9. compara novamente Local × Central;
10. só informa sucesso quando não restam divergências.

Também foi adicionada uma proteção para impedir **Baixar Base Central neste dispositivo**
quando o computador possui uma base local significativamente maior que a Central.

Isso evita apagar acidentalmente os 1.245 produtos locais antes da migração.

## Divergência 8 Local × 9 Central
O modo de correção trata o computador como fonte oficial. Assim, uma unidade central
extra de teste/bootstrap que não exista localmente é removida durante a reconciliação.

## Versões
- Frontend: 4.0.2
- Backend: 4.0.2
- Cache/PWA: okeo-core-v4-0-2

## Validação
19/19 verificações estruturais específicas desta correção foram aprovadas, incluindo:
- sintaxe frontend/backend/db/service worker;
- backup obrigatório;
- gate de versão do backend;
- gate de base local completa;
- upload em bulk;
- remoção de extras;
- comparação pós-reparo;
- bloqueio de download perigoso;
- referências HTML e Service Worker.
