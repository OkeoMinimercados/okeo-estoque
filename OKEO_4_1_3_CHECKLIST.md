# OKEO 4.1.3 — checklist curto

1. Publicar frontend 4.1.3 no GitHub Pages.
2. Publicar backend 4.1.3 como nova versão da mesma implantação Apps Script.
3. Não refazer o snapshot.
4. No computador:
   - atualizar/reabrir;
   - Saúde → Revisão rápida;
   - confirmar Backend 4.1.3, Modo Produção ativo, snapshot alinhado e sem erros atuais.
5. No celular:
   - atualizar/reabrir;
   - usar **Atualizar dispositivo agora** / **Atualizar este dispositivo pela Central**;
   - confirmar o descarte seguro da fila antiga;
   - Saúde → Revisão rápida.
6. Confirmar no celular:
   - snapshot alinhado;
   - fila 0;
   - invariantes preservadas;
   - produtos, fornecedores e unidades carregados.
7. Teste de crescimento:
   - criar 1 fornecedor teste;
   - criar 1 produto teste;
   - criar 1 unidade teste;
   - verificar sincronização no outro dispositivo;
   - remover/inativar os registros de teste.
8. Se passar, congelar 4.1.3 como produção.
