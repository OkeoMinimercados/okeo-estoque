# OKEO 4.1.8 — correção do loop automático de login/logout

Causa:
uma sessão persistente podia ter sido emitida pela Base Central anterior e continuar no
localStorage após a troca da URL. Ao iniciar, o frontend tentava reaproveitar o token na
nova Central, entrava parcialmente e em seguida era expulso, criando o efeito de
login/logout automático.

Correções:
- sessão lembrada passa a registrar a URL/deployment que a emitiu;
- uma sessão só pode fazer auto-login na mesma Base Central;
- troca de URL invalida imediatamente tokens/sessões da Central anterior;
- `showApp()` bloqueia uma sessão vinculada a outra Central;
- após salvar uma nova URL, o sistema volta explicitamente à tela de login;
- não existe auto-login cruzado entre implantações;
- mantidas as proteções de snapshot, fila e rollback.

Após instalar 4.1.8, o comportamento esperado é permanecer parado na tela de login até
o usuário clicar em Entrar.
