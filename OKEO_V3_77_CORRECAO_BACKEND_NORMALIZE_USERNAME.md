# OKEO V3.77 — Correção backend normalizeLoginUsername_

## Erro confirmado
O Apps Script V3.76 chamava `normalizeLoginUsername_()` em:
- `bootstrapAdmin_()`
- `login_()`

Porém o backend só continha `normalizeLoginPassword_()`.

Por isso a Base Central devolvia:
`normalizeLoginUsername_ is not defined`

## Correção
Foi implementado `normalizeLoginUsername_()` diretamente no backend, com:
- normalização NFKC;
- remoção de caracteres invisíveis;
- remoção de CR/LF/TAB;
- trim;
- lowercase.

Bootstrap e login passam a usar a mesma regra de usuário.

## Validação
Foram validados:
- sintaxe do frontend;
- sintaxe do backend;
- existência dos dois helpers no backend;
- chamadas no bootstrap e login;
- smoke test em runtime dos helpers.
