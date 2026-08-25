# OKEO V3.69 — Correção de login entre desktop e celular

## Diagnóstico
A V3.68 já confirmava Base Central online e backend correto.
O erro restante era `AUTH_INVALID`, vindo da validação da credencial.

## Correção
A normalização da credencial agora acontece também no backend:
- NFKC para diferenças de teclado/navegador;
- remoção de caracteres invisíveis;
- remoção de CR/LF/TAB introduzidos por input móvel;
- conversão de espaço não separável;
- tentativa segura com senha original, normalizada e apenas com espaços externos removidos;
- fallback case-insensitive no nome do usuário.

## Segurança
- não existe login offline;
- não existe bypass;
- a senha continua sendo obrigatoriamente comparada ao hash salvo;
- nenhum conteúdo de senha é registrado em log.

## Importante
Como uma senha foi exibida em uma captura durante o diagnóstico, recomenda-se trocá-la após restabelecer o acesso.

## Validação
14/14 verificações aprovadas.
