# OKEO V3.73 — Correção definitiva do USER_NOT_FOUND

## Causa encontrada

A Base Central respondia corretamente, mas o usuário `admin` não existia nela.
O backend já possuía uma função segura de bootstrap para criar o primeiro
Administrador quando a base de usuários estivesse vazia.

O erro era no frontend: `checkBootstrapStatus()` existia, porém nunca era chamado,
e o HTML não possuía mais o formulário de bootstrap.

Por isso o sistema mostrava apenas `USER_NOT_FOUND`.

## Correção

- o login consulta `bootstrap_status` automaticamente;
- se a Base Central estiver sem usuários, aparece o bloco
  **Base Central sem Administrador**;
- o usuário cria o primeiro Administrador e uma nova senha;
- bootstrap só funciona enquanto a Base Central possui zero usuários;
- depois da criação, o formulário desaparece e o login normal é utilizado;
- ao receber `USER_NOT_FOUND`, o frontend verifica automaticamente se é uma base vazia;
- mensagem antiga específica de celular foi removida.

## Segurança

A proteção `BOOTSTRAP_LOCKED` continua ativa no backend.
Assim que existir qualquer usuário, não é possível criar outro Administrador por bootstrap.

## Validação

12/12 verificações aprovadas.
