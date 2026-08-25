# OKEO V3.67 — Correção da Base Central

A URL oficial da Base Central agora faz parte do frontend como fallback:

https://script.google.com/macros/s/AKfycbxFBV9P3t0t4FAX4y83yPhQpQnDmLJzNsp4afqoD6NKXMBROOO6Zm-00fuWgqjrcvgq/exec

Comportamento:
- navegador/celular novo recebe a conexão automaticamente;
- localStorage vazio não bloqueia mais por "Conexão não configurada";
- a URL é persistida após resolução;
- login repete a tentativa usando o endereço oficial;
- campo vazio restaura a conexão oficial;
- botão "Restaurar conexão oficial" disponível no login;
- Administrador continua podendo trocar a implantação /exec.

Validação: 10/10 verificações aprovadas.
