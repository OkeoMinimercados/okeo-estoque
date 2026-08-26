# OKEO 4.1.6 — Saúde vinculada à URL ativa

Correção:
- Saúde não reutiliza mais `backendRequest()` para identificar a Central.
- A revisão consulta diretamente a URL atualmente configurada, pelo mesmo probe sem preflight da 4.1.5.
- Mostra o final do deployment efetivamente consultado.
- Ao trocar de Base Central, um snapshot local pertencente à Central anterior deixa de ser tratado como alinhado.
- A nova Central em pré-produção aparece como pré-produção/snapshot inexistente, em vez de herdar o estado visual da Central anterior.

Proteções de fila, snapshot, rollback e ativação atômica de URL permanecem.
Não refazer snapshot antes de validar esta Saúde.
