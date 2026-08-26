# OKEO 4.1.4 — correção da troca de Base Central

A troca da URL agora é transacional:

- o botão Salvar URL testa diretamente a URL digitada;
- usa `fetch` com `no-store` e parâmetro anti-cache;
- não usa a URL previamente resolvida durante a validação;
- exige que a implantação responda a versão esperada antes de ativá-la;
- se falhar, mantém a conexão anterior;
- ao ativar, invalida o cache de compatibilidade;
- mostra versão, final do deployment, modo Produção e snapshot efetivamente consultados;
- Testar Base Central testa a URL que está visível no campo, mesmo antes de salvá-la.

As proteções da 4.1.3 para snapshot, fila antiga e rollback permanecem.
