# OKEO Estoque V2.5 — Compras + Login + Perfis

Login:
- primeiro administrador criado diretamente na tela de login;
- usuários e perfis gerenciados dentro do OKEO;
- qualquer usuário pode alterar a própria senha pelo menu da conta;
- administrador pode editar usuário, perfil, nome, observação e redefinir senha;
- último acesso registrado.

Compras/NF:
- lançamento manual;
- leitura automática de XML NF-e para fornecedor, nº NF, data, EAN, quantidade e custo;
- lote/validade capturados quando existirem no XML;
- PDF/foto podem ser anexados;
- Demanda Inteligente considera estoque atual e reposições já aprovadas/em trânsito;
- prioridade: Ruptura → Reposição → sobra para CD;
- distribuição totalmente editável;
- confirmação atualiza estoque, movimentação, custo e validade por destino.
