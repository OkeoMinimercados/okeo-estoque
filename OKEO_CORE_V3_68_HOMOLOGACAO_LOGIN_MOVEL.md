# OKEO V3.68 — Correção de login no celular

Correções:
- autocapitalização e autocorreção desativadas nos campos de usuário e senha;
- remoção de caracteres invisíveis inseridos por teclado/autofill móvel;
- tentativa segura adicional quando a senha contém espaços invisíveis ou acidentais nas extremidades;
- cache do Service Worker alterado para V3.68;
- caches antigos do OKEO são removidos na ativação;
- assets continuam em estratégia network-first;
- Enter nos campos dispara login;
- mensagem de erro orienta sobre senha antiga salva no autofill.

A autenticação continua sendo validada pela Base Central; não foi criado login offline nem bypass de senha.

Validação: 10/10 verificações aprovadas.
