# OKEO V3.75 — Correção do botão Criar Administrador

## Causa exata

O `bind()` geral do frontend continha referências diretas a elementos que já haviam
sido removidos de algumas telas.

Foram identificados, entre outros:

- productUnitToggle
- productUnitSearch
- productUnitSelectAll
- productUnitClearAll
- repUnitsToggle
- repUnitSearch
- repSelectAll
- repClearUnits
- repDraft
- repApprove

Ao tentar executar `.onclick`, `.oninput` ou `.onchange` em um elemento inexistente,
o JavaScript lançava uma exceção e interrompia `bind()`.

O vínculo do botão `bootstrapCreate` ficava depois dessas instruções.
Por isso o botão aparecia visualmente, mas o clique não tinha função associada.

## Correções

- controles críticos de login/bootstrap são vinculados antes do bind geral;
- botão Criar Administrador possui fallback direto `onclick`;
- falha em módulo secundário não derruba mais o login;
- referências antigas identificadas passaram a ser condicionais;
- o botão mostra feedback imediato:
  - Clique recebido;
  - Validando dados;
  - Enviando para a Base Central;
  - Administrador criado / abrindo sistema;
  - ou erro correspondente.

## Resultado

Mesmo que outro módulo do sistema contenha um elemento ausente, o login e o
bootstrap continuam funcionais.

## Validação

11/11 verificações aprovadas.
