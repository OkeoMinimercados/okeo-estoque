# OKEO 4.1.2 — Homologação final do diagnóstico

## O que foi corrigido

A 4.1.1 ainda podia registrar `DEEP_HEALTH_CHECK / TIMEOUT_BASE_CENTRAL` porque a
própria Saúde dependia de uma chamada remota que, quando excedia o tempo, interrompia
a revisão inteira.

Na 4.1.2:

- a Saúde faz somente **uma chamada remota leve** (`status`);
- essa chamada é isolada em `healthBackendProbe()`;
- timeout/rede lenta vira **AVISO**, e não interrupção da revisão;
- testes locais continuam e sempre produzem resultado;
- cada etapa local crítica é isolada com `healthLocalStep()`;
- a Saúde não grava seu próprio timeout como erro operacional;
- o erro legado `DEEP_HEALTH_CHECK / TIMEOUT_BASE_CENTRAL` das builds anteriores é
  filtrado especificamente, sem esconder outros erros reais;
- erros operacionais novos continuam sendo exibidos normalmente;
- resultado da Saúde é persistido para diagnóstico.

## Cenários verificados

Foram verificados explicitamente:

1. Central respondendo normalmente;
2. Central lenta/timeout — revisão local termina com aviso;
3. Central indisponível — revisão local termina com aviso;
4. erro local em uma etapa — demais testes continuam;
5. erro operacional real — continua aparecendo em “Erros operacionais atuais”;
6. snapshot e Modo Produção permanecem intactos;
7. nenhum snapshot precisa ser refeito.

## Regressão

- 18/18 verificações específicas do patch: aprovadas.
- bateria ampliada completa: aprovada integralmente.
- sintaxe frontend, DB, Service Worker e backend: aprovada.
- nenhuma ação frontend sem rota correspondente no backend.
- nenhuma rota de tela inexistente.
- nenhum identificador JavaScript interno inesperado no checkJs.
- modelos E2E de compra imediata, compra via CD e bloqueio por validade: aprovados.

## O que NÃO mudou

Não foram alterados:
- estoque;
- snapshot já existente;
- compras;
- contagens;
- fornecedores;
- validades;
- fluxo CD;
- dados da Base Central.

A versão 4.1.2 é um endurecimento final de diagnóstico e tolerância à rede.
