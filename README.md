# OKEO Estoque V2.1 — UI Verde + Login Seguro

Principais mudanças:
- Interface redesenhada com identidade OKEO predominantemente verde e branca.
- Login redesenhado e validado no Apps Script; senha não fica mais hard-coded no GitHub.
- Sessão de 12 horas com token; app só é exibido depois da validação.
- Todos os endpoints de leitura/escrita do Apps Script exigem sessão válida.
- `base-master.json` removido do pacote público; produtos e unidades são carregados da Base Central autenticada.
- Central de Reposição agora usa seleção múltipla de unidades e uma data de abastecimento escolhida pelo usuário.
- O cálculo de reposição só inclui as unidades selecionadas.
- Mantidas todas as correções operacionais da V2.0.1.

## Configuração do primeiro acesso
1. Atualize o Apps Script e execute `setupOkeoEstoqueV21`.
2. Execute `setupAdminLoginOkeoV21`.
3. Abra o **Registro de execução** do Apps Script: ele mostrará o usuário `admin` e uma senha inicial aleatória.
4. Guarde a senha e atualize a implantação para a nova versão.

O endereço da Base Central já vem configurado no aplicativo, permitindo login em um navegador novo.
