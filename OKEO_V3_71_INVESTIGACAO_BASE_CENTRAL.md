# OKEO V3.71 — Investigação de login cross-device

Foi adicionada identificação da Base Central para provar se computador e celular estão autenticando no mesmo deployment do Apps Script.

Mudanças:
- URL oficial é usada por padrão em todos os dispositivos;
- URL customizada só prevalece se salva explicitamente pelo Administrador;
- status mostra fingerprint da Base Central;
- backend retorna fingerprint e final do deployment;
- falha de autenticação informa também a Base que rejeitou a credencial.

Validação prática:
1. publicar frontend e backend 3.71;
2. comparar no computador e celular: `Base Central online • backend 3.71.0 • base XXXXXXXX`;
3. os códigos precisam ser idênticos;
4. se forem diferentes, eram bases/deployments diferentes;
5. se forem iguais, o código `PASSWORD_MISMATCH`, `USER_NOT_FOUND` etc. aponta a causa exata.

Validação técnica: 9/9 aprovada.
