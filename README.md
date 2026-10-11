# Topet’s Lanches — site e painel administrativo

Site estático em HTML, CSS e JavaScript. O site público mantém o cardápio local como fallback; quando o Supabase está configurado, carrega o catálogo ativo e as configurações do banco a cada visita. O painel fica em `/admin/`.

## Arquivos novos e integração

- `admin/index.html`, `admin/admin.js`, `admin/admin.css`: login e painel responsivo para produtos, categorias, adicionais, imagens e configurações de açaí e entrega.
- `supabase-api.js`: chamadas diretas à API do Supabase Auth, Database e Storage. Não há cadastro público de administrador.
- `supabase-data.js`: entrada do carregamento remoto para o site público.
- `supabase-config.js`: configuração pública gerada no build; contém somente URL e chave `anon` do Supabase.
- `.env.example` e `configure-supabase.mjs`: modelo e gerador de configuração para desenvolvimento e hospedagem.
- `supabase/schema.sql`: tabelas, bucket e políticas RLS.
- `supabase/seed.sql`: migra os 151 produtos existentes, com IDs preservados, e as configurações atuais. A importação não duplica IDs nem substitui produtos já editados.
- `supabase/sales.sql`: migração aditiva para vendas confirmadas, itens com snapshots, políticas RLS e RPCs atômicas para registrar, editar e cancelar vendas.
- `supabase/orders.sql`: migração aditiva de pedidos públicos pendentes e vínculo atômico com vendas, sem permitir leitura ou alteração de status pelo cliente.

O `app.js` público recebe o catálogo remoto sem mudar as regras do carrinho, personalização, adicionais, entrega, pagamento ou WhatsApp. Os cards mostram imagem apenas quando o administrador cadastrar uma. Adicionais continuam sendo produtos da categoria `Adicionais`; as coberturas ficam nas configurações; o limite de coberturas é editado por produto/tamanho de açaí. Categorias vazias podem ser criadas no painel.

## Configuração do Supabase

1. Crie um projeto Supabase e copie a **Project URL** e a chave pública **anon** (nunca use `service_role` no site).
2. No **SQL Editor**, execute `supabase/schema.sql` e depois `supabase/seed.sql`. O segundo arquivo importa o cardápio existente uma única vez por ID e pode ser reaplicado sem sobrescrever alterações administrativas.
3. Em **Authentication → Users**, crie o primeiro usuário com o e-mail e a senha que o proprietário usará. Não existe tela de cadastro no site. Desative novos cadastros em **Authentication → Settings → User Signups**.
4. Copie o UUID desse usuário e execute no SQL Editor, trocando o UUID de exemplo:

   ```sql
   insert into public.admin_users (user_id)
   values ('COLE-AQUI-O-UUID-DO-USUARIO');
   ```

   Somente usuários com uma linha nessa tabela são administradores. A política RLS controla o acesso mesmo que alguém chame a API diretamente.
5. Copie `outputs/.env.example` para `.env` na pasta do projeto (fora de `outputs`), preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` com os valores públicos do projeto e gere o arquivo usado pelo navegador:

   ```powershell
   Copy-Item outputs/.env.example .env
   # Edite .env e preencha os dois valores
   node outputs/configure-supabase.mjs
   ```

   O arquivo gerado `supabase-config.js` contém a chave pública `anon`, que é feita para uso no navegador e fica protegida pelas políticas RLS. Nunca coloque uma chave `service_role`, senha ou segredo de servidor no site.
6. Na hospedagem, configure as variáveis `SUPABASE_URL` e `SUPABASE_ANON_KEY` no ambiente de build e execute `node outputs/configure-supabase.mjs` antes de publicar `outputs`. Não foi possível configurar as variáveis na hospedagem porque esta cópia não contém acesso à conta nem ao pipeline do GitHub Pages. O arquivo `.env` é local, fica fora da pasta pública e não deve ser publicado.
7. Publique os arquivos da pasta `outputs`. Entre em `https://SEU-SITE/admin/`. O primeiro acesso é o e-mail e a senha criados no Supabase. O cliente pode editar os produtos no painel sem nova publicação; novas visitas ao site público recebem os dados atuais do banco.

### Relatórios e vendas

Execute `supabase/sales.sql` no SQL Editor depois do schema e depois `supabase/orders.sql`. As migrações são aditivas; não alteram produtos, vendas antigas nem importam pedidos fictícios. O checkout cria pedidos pendentes via RPC pública, mas os dados só podem ser consultados por administradores autorizados. O cliente não recebe acesso de leitura nem pode confirmar ou alterar status. A RPC confere os preços dos produtos/adicionais e as taxas configuradas no banco.

Ao confirmar um pedido no painel, uma RPC administrativa bloqueia a linha do pedido, cria a venda e os itens com snapshots e vincula o pedido à venda na mesma transação. Confirmações repetidas devolvem a venda vinculada, sem criar outra. Se a venda for cancelada posteriormente, o pedido original permanece no histórico e aparece como ligado a uma venda cancelada. A taxa de entrega de bairros que exigem consulta é informada pelo administrador ao confirmar.

No painel, abra **Pedidos do site** para revisar pedidos pendentes, consultar todos os dados e confirmar uma venda ou marcar o pedido como não concretizado. Pedidos pendentes e não concretizados ficam fora dos relatórios. Vendas externas ainda podem ser registradas manualmente em **Relatórios e vendas**. Edições e cancelamentos de vendas existentes continuam disponíveis. As consultas são limitadas a 1.000 registros por chamada.

Os cartões mostram faturamento bruto registrado (já com desconto e entrega), quantidade, ticket médio e produto mais vendido; não calculam lucro. Os relatórios não usam dados de demonstração. Para validar a integração na sua conta, depois de executar a migração, entre como administrador, registre uma venda real confirmada (ou uma venda de verificação identificada e cancele-a em seguida), revise o histórico e confira que o cancelamento sai dos indicadores.

O bucket `product-images` é público para leitura das imagens do cardápio e exige sessão de administrador para enviar, alterar ou apagar arquivos. As tabelas de produtos e configurações permitem leitura pública; alterações exigem `is_topets_admin()` via RLS. As linhas inativas não aparecem no cardápio público.

## Verificação

As verificações automatizadas locais usam respostas simuladas. Não enviam pedidos de teste à base configurada. Depois de executar `sales.sql` e `orders.sql`, teste com um pedido real de verificação no site, confirme o protocolo na mensagem do WhatsApp, revise o pedido em **Pedidos do site**, confirme-o uma única vez e confira nos relatórios. Em seguida teste um segundo pedido marcado como não concretizado; ele deve permanecer no histórico e ficar fora dos indicadores. Para validar RLS na sua instância, confirme que chamadas anônimas a `customer_orders` e `order_items` não retornam linhas e que `create_topets_order` cria apenas pedidos pendentes; uma conta autenticada fora de `admin_users` também deve falhar ao listar ou confirmar pedidos. Não compartilhe a chave `service_role` para esses testes.

Para visualizar sem Supabase durante o desenvolvimento, sirva a pasta por HTTP:

```powershell
python -m http.server 8000 --directory outputs
```

Depois abra `http://localhost:8000`. Sem configurar Supabase, o site público usa o menu local e o painel informa que falta configuração.
