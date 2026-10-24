# Cerimonial — evolução multiunidades (etapa de desenvolvimento)

**Estado em 24/10/2026:** tabelas e RPC de multiunidades implantadas no Supabase e verificadas. A Edge Function e o frontend multiunidades ainda NÃO foram publicados. Conta Master criada e vinculada ao perfil `master`, com login de sistema `MASTER`; autenticação pela interface ainda pendente. A versão funcional de teste permanece preservada no GitHub. Não copiar direto para `main` ou para a pasta que está sendo usada operacionalmente.

## Regras atendidas nesta proposta

- Um login compartilhado por unidade (BAGL, BABR etc.); dados independentes por unidade.
- O mesmo login em vários aparelhos recebe as mesmas marcações, sincronizadas.
- Um único carômetro por unidade, sem históricos. Persiste até a própria unidade excluí-lo.
- Master pode criar/desativar unidades, definir senha e e-mail de recuperação, redefinir senha e liberar limite de recuperação; não acessa os carômetros das unidades.
- Trocar senha é **opcional**, inclusive no primeiro acesso.
- Esquecimento: informa login, vê **e-mail completo**, confirma envio, usa link para criar senha nova. O destinatário é sempre o e-mail vinculado à unidade, não editável pelo operador.
- Proteção no servidor: 5 minutos entre envios à mesma unidade; até 3 envios/hora por unidade; até 10/hora por origem de conexão; após excesso, recuperação suspensa temporariamente, não o login. Consulta de e-mails limitada a 20/hora por origem.
- Somente Master altera o e-mail de recuperação.

## O que há no pacote

1. `supabase/migrations/cerimonial_multi_unidades.sql` — cria tabelas separadas e API SQL server-only; não altera nem exclui carômetros existentes.
2. `supabase/functions/cerimonial-multi/index.ts` — API de Auth, Master, recuperação e carômetros com contas isoladas.
3. `js/modules/sync.js` — sincronização passa a identificar unidade via sessão, não por UUID fixo.
4. `js/modules/accounts.js` — telas de recuperação, troca de senha e painel Master.
5. `index.html` — incorpora módulo de contas, mantendo a aparência de login já homologada.
6. `js/app.js`, `js/modules/nominata.js`, `sw.js` — mantém correções preventivas de dados de PDF e evita ressuscitar conteúdo do cache offline.

## Passos de homologação — executar antes da publicação

1. Criar uma **branch de trabalho independente** para esta implementação. **Não** sobrescrever `main` e não usar `git add .` indiscriminadamente (o projeto local contém outros arquivos sensíveis).
2. **CONCLUÍDO:** migrações Supabase `cerimonial_multiunidades_estrutura_inicial` e `cerimonial_multiunidades_api_isolada`. RLS ativada, acesso `anon`/`authenticated` revogado, RPC executável somente pelo `service_role`. Não reaplicar sem conferir o histórico.
3. No Supabase Auth, manter cadastro público de usuários desabilitado ou, mesmo se habilitado, garantir que nenhum usuário sem vínculo explícito com `cerimonial_private.unidades` possa usar a API. O código valida esse vínculo em toda operação.
4. Configurar serviço **SMTP personalizado** para e-mails de recuperação. O SMTP padrão do Supabase pode recusar entrega a e-mails fora da equipe do projeto. Verificar entrega ao domínio institucional com a ACS antes de ativar.
5. Em **Auth > URL Configuration**, configurar o endereço oficial `https://amaldydaniel.github.io/Cerimonial-BAGL/` como URL de redirecionamento permitida para reset. Links podem sofrer interferência de filtros institucionais de e-mail; validar clique real.
6. **PRÓXIMA ETAPA MANUAL:** Criar uma única conta Master no Supabase Auth **com e-mail próprio e senha forte**, marcar e-mail confirmado, e anotar **somente** o UUID do usuário de Auth. Para associá-lo ao papel Master, executar SQL manual (substituir os valores exemplificativos):

```sql
INSERT INTO cerimonial_private.unidades
  (login, nome, email, auth_user_id, role, active, event_id)
VALUES
  ('MASTER', 'Administrador Geral', 'EMAIL_MASTER_AQUI',
   'UUID_DO_USUARIO_AUTH_AQUI'::uuid, 'master', true, NULL);
```

7. Implantar a função com o nome **`cerimonial-multi`** (não substituir `cerimonial-sync` ou `cerimonial-sync-teste`). Nesta versão, `verify_jwt=false` porque a própria função verifica **cada token** consultando `Auth /user`, e também confere o papel/unidade no banco. Nunca expor a `SUPABASE_SERVICE_ROLE_KEY` ao navegador.
8. Criar duas contas de homologação pelo painel Master e testar cada unidade em dois navegadores: importar PDF, conferir presença sincronizada dentro da mesma unidade, verificar separação entre unidades, sair e entrar, atualizar navegador, excluir sem afetar outra unidade, alterar senha, recuperar por e-mail, testar limites de envio, desativar/reativar.
9. Somente após aprovação dos testes, preparar merge para `main` e teste final em produção.

## Senhas iniciais curtas: atenção

O usuário solicitou login/senha iniciais como `BAGL/BAGL` e `BABR/BABR`, sem troca obrigatória. O Supabase Auth aplica a política de comprimento/complexidade definida no projeto, que **pode recusar senhas de quatro caracteres**. Este pacote não altera silenciosamente a política de Auth. Validar compatibilidade antes de cadastrar unidades. Por segurança, é recomendável manter a senha inicial distinta do login, embora a experiência de acesso continue compartilhada por unidade.

## Observações

- O segredo legado `CERIMONIAL_SHARED_PASSWORD` pertence à proposta anterior de conta única e **não é utilizado** pela versão multiunidades com Supabase Auth. Não excluir segredos enquanto outras funções puderem depender deles.
- Troca ou redefinição de senha não exclui nem reescreve carômetros. Sessões já emitidas pelo Supabase Auth podem permanecer válidas até expirar; revisar política de revogação antes da publicação operacional.
- Proteções de IP podem variar conforme cabeçalhos de proxy; validar o ambiente Supabase e proteger a rota com rate limiting de borda caso seja necessária resistência forte a automação.
- O pacote pressupõe os demais módulos, imagens e estilos que já estão no repositório. Ele é uma **atualização**, não um aplicativo completo isolado.
- Testes estáticos: `node testes/verificar_estrutura.js`. É obrigatória homologação real de SMTP, autenticação e acesso por unidade antes de publicar.

Referências: https://supabase.com/docs/guides/auth/passwords e https://supabase.com/docs/guides/auth/auth-smtp
## Pendência identificada

O Security Advisor aponta a antiga RPC `public.cerimonial_sync` como `SECURITY DEFINER` executável por `anon` e `authenticated`. A RPC antiga não foi alterada nesta etapa para preservar o serviço. Revisar e corrigir privilégios antes da publicação final, validando dependências. As tabelas privadas com RLS sem políticas são intencionais porque apenas funções internas privilegiadas as acessam.

## Progresso em 24/10/2026 — conta Master

- Supabase Auth: conta Master existente e e-mail confirmado.
- Vinculada na tabela privada `cerimonial_private.unidades` com login `MASTER`, papel `master`, ativa e sem `event_id`.
- API SQL `cerimonial_multi_api('whoami')` retornou o papel correto e `list_units` retornou lista vazia (nenhuma unidade cadastrada ainda).
- Número de eventos preexistentes preservado (3).
- A nova Edge Function ainda não está implantada; por isso **não** é possível entrar como Master no site atual.
- Próximo passo: validar fluxo de autenticação na função isolada e configurar SMTP e redirecionamento para recuperação.
