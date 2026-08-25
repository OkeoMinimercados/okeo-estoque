# OKEO V3.74 — Criação do primeiro Administrador + login atômico

Correção do fluxo amarelo de bootstrap.

Agora o botão executa em uma única operação:
1. cria o usuário Administrador;
2. grava o hash salted;
3. relê o usuário da Base Central;
4. valida a própria senha contra o hash persistido;
5. cria a sessão;
6. retorna token e permissões;
7. abre o Dashboard automaticamente.

Se a persistência falhar, o backend retorna `BOOTSTRAP_PERSISTENCE_FAILED` e não simula sucesso.

Se a Base já tiver usuário, permanece protegida por `BOOTSTRAP_LOCKED`.

Validação: 10/10 verificações aprovadas.
