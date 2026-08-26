# OKEO 4.1.3

Build de estabilização final de dispositivos.

Principais garantias:
- dispositivo com snapshot antigo não envia fila nem grava operações;
- atualização pela Central valida snapshot completo antes de substituir dados;
- fila antiga é descartada somente depois da validação;
- rollback local em falha;
- conflitos locais de fornecedor não são enviados à Central;
- alertas transitórios de versão deixam de reprovar após recuperação;
- novos produtos, fornecedores e unidades continuam sendo dados normais do sistema.

Não refaça o snapshot apenas para instalar esta versão.
