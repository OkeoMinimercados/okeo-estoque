# OKEO 4.1.5 — correção `Failed to fetch`

Causa provável identificada na 4.1.4:
o teste direto da URL enviava cabeçalhos `Cache-Control` e `Pragma`.
Esses cabeçalhos tornam a requisição CORS não simples e podem fazer o navegador
executar um preflight `OPTIONS`. O Web App do Google Apps Script `/exec` não oferece
um endpoint OPTIONS compatível, resultando em `Failed to fetch`.

A 4.1.5:
- remove os cabeçalhos customizados do teste;
- mantém GET simples;
- mantém `cache: no-store`;
- mantém parâmetro `_=` para evitar cache;
- continua testando exatamente a URL digitada;
- mantém ativação atômica da URL;
- preserva a conexão antiga se a URL nova não validar;
- preserva as proteções de snapshot/fila/rollback da 4.1.3.

Não é necessário refazer o snapshot para instalar esta correção.
