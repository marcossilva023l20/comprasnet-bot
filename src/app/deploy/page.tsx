import Link from "next/link";

export default function DeployPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-[#1351b4] text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-blue-200 hover:text-white text-sm">← Voltar</Link>
            <span className="text-blue-300">›</span>
            <h1 className="font-bold">🚀 Como Hospedar (GitHub + Neon + Vercel)</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-10 space-y-8">

        {/* Hero */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-2xl p-8 shadow-xl">
          <h1 className="text-2xl font-black mb-2">Deploy Gratuito em 3 Passos</h1>
          <p className="text-slate-300 text-sm mb-6">
            GitHub → Neon → Vercel. Tudo gratuito, sem servidor para gerenciar.
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { icon: "🐱", label: "GitHub", sub: "Código-fonte" },
              { icon: "🐘", label: "Neon", sub: "PostgreSQL gratuito" },
              { icon: "▲", label: "Vercel", sub: "Hosting gratuito" },
            ].map((s) => (
              <div key={s.label} className="bg-white/10 rounded-xl p-4">
                <div className="text-3xl mb-1">{s.icon}</div>
                <div className="font-bold">{s.label}</div>
                <div className="text-xs text-slate-400">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* No PR flow */}
        <div className="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-2xl p-6">
          <div className="flex items-start gap-4 flex-wrap justify-between">
            <div>
              <h2 className="text-lg font-black text-emerald-800 mb-1">✅ Deploy automático sem PR</h2>
              <p className="text-sm text-emerald-700 max-w-3xl">
                Conecte o repositório ao Vercel e escolha a branch de produção (normalmente <code>main</code>).
                Com a integração Git do Vercel ativa, cada push nessa branch publica uma nova versão — sem workflow
                próprio do GitHub Actions e sem secrets extras no GitHub.
              </p>
            </div>
            <div className="bg-white border border-emerald-200 rounded-xl px-4 py-3 text-sm">
              <p className="font-bold text-emerald-800">Na branch de produção configurada:</p>
              <code className="text-emerald-700 font-mono text-xs">git push origin main</code>
            </div>
          </div>
        </div>

        {/* Step 1: GitHub */}
        <Section n="1" color="bg-gray-900 text-white" title="🐱 Publicar no GitHub">
          <div className="space-y-4 text-sm">
            <p className="text-slate-300">Primeiro, publique o código no GitHub.</p>

            <Step n="1.1" title="Crie um repositório no GitHub">
              <p>Acesse <a href="https://github.com/new" target="_blank" rel="noopener" className="text-blue-400 hover:underline">github.com/new</a>, crie um repositório privado chamado <code className="bg-white/10 px-1 rounded">comprasnet-bot</code></p>
            </Step>

            <Step n="1.2" title="Faça o push do código">
              <Code>{`git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/SEU_USUARIO/comprasnet-bot.git
git push -u origin main`}</Code>
            </Step>

            <div className="bg-green-900/40 border border-green-700 rounded-xl p-4 text-green-300 text-sm">
              ✅ Repositório criado! Agora vamos criar o banco de dados.
            </div>
          </div>
        </Section>

        {/* Step 2: Neon */}
        <Section n="2" color="bg-teal-900 text-white" title="🐘 Criar banco no Neon (grátis)">
          <div className="space-y-4 text-sm">
            <p className="text-slate-300">Neon oferece PostgreSQL serverless gratuito — perfeito para o Vercel.</p>

            <Step n="2.1" title="Crie uma conta no Neon">
              <p>Acesse <a href="https://neon.tech" target="_blank" rel="noopener" className="text-teal-300 hover:underline">neon.tech</a> → <strong>Sign up free</strong> (pode usar o GitHub para login rápido)</p>
            </Step>

            <Step n="2.2" title="Crie um novo projeto">
              <p>Clique em <strong>&quot;New Project&quot;</strong> → dê um nome → selecione a região <strong>South America (São Paulo) — sa-east-1</strong> (menor latência para o Brasil) → clique <strong>Create Project</strong></p>
            </Step>

            <Step n="2.3" title="Copie a connection string">
              <p>Na tela do projeto, vá em <strong>Connection details</strong> → selecione <strong>Pooled connection</strong> → copie a string. Ela terá este formato:</p>
              <Code>{`postgresql://usuario:senha@ep-xxxx-xxxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require`}</Code>
              <p className="text-slate-400 text-xs mt-2">
                Tanto a string <strong>pooled</strong> quanto a direta funcionam: o app usa o driver HTTP do Neon,
                que converte o host em <code className="text-teal-300">https://api.sa-east-1.aws.neon.tech/sql</code>.
                Se o Neon entregar a URL com <code>&amp;channel_binding=require</code>, pode deixar — é aceito.
              </p>
              <p className="text-slate-400 text-xs mt-2">⚠️ Guarde bem essa string — será usada no Vercel.</p>
            </Step>

            <Step n="2.4" title="Crie as tabelas (automático ou manual)">
              <p>
                <strong>Automático:</strong> o build deste projeto roda <code>npm run db:migrate</code> e cria as
                tabelas <code>propostas</code> e <code>itens</code> sozinho. Basta a <code>DATABASE_URL</code> estar
                na Vercel antes do primeiro deploy.
              </p>
              <p className="mt-2">
                <strong>Manual</strong> (opcional — para criar antes ou se o build falhar), rode localmente com a mesma string:
              </p>
              <Code>{`DATABASE_URL="postgresql://..." npm run db:migrate`}</Code>
              <p className="text-slate-400 text-xs mt-1">
                É idempotente: pode rodar quantas vezes quiser, só aplica o que ainda falta.
              </p>
            </Step>

            <div className="bg-green-900/40 border border-green-700 rounded-xl p-4 text-green-300 text-sm">
              ✅ Banco criado! Agora vamos hospedar no Vercel.
            </div>
          </div>
        </Section>

        {/* Step 3: Vercel */}
        <Section n="3" color="bg-black text-white" title="▲ Deploy no Vercel (grátis)">
          <div className="space-y-4 text-sm">
            <p className="text-slate-300">Vercel detecta automaticamente projetos Next.js e faz o deploy.</p>

            <Step n="3.1" title="Crie uma conta no Vercel">
              <p>Acesse <a href="https://vercel.com" target="_blank" rel="noopener" className="text-blue-400 hover:underline">vercel.com</a> → <strong>Sign up</strong> → escolha <strong>Continue with GitHub</strong></p>
            </Step>

            <Step n="3.2" title="Importe o repositório">
              <p>No dashboard do Vercel, clique em <strong>&quot;Add New → Project&quot;</strong> → selecione o repositório <strong>comprasnet-bot</strong> → clique <strong>Import</strong></p>
            </Step>

            <Step n="3.3" title="Configure a variável de ambiente">
              <p>
                Em <strong>Environment Variables</strong>, adicione a variável abaixo marcando os 3 ambientes
                (<em>Production</em>, <em>Preview</em> e <em>Development</em>) — ela precisa existir antes do
                primeiro deploy, porque o build usa a URL para criar as tabelas:
              </p>
              <div className="bg-white/5 rounded-xl border border-white/10 p-4 font-mono text-xs space-y-1">
                <div><span className="text-slate-400">Nome: </span><span className="text-green-400">DATABASE_URL</span></div>
                <div><span className="text-slate-400">Valor: </span><span className="text-yellow-300">postgresql://usuario:senha@ep-xxxx-xxxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require</span></div>
              </div>
              <p className="text-slate-400 text-xs mt-2">
                Não mexa em <strong>Build Command</strong>: o padrão (<code>npm run build</code>) já aplica as
                migrações e gera o ZIP da extensão. Se quiser pular as migrações no build,
                adicione também <code>SKIP_DB_MIGRATIONS=1</code>.
              </p>
            </Step>

            <Step n="3.4" title="Clique em Deploy!">
              <p>Clique em <strong>Deploy</strong>. O Vercel vai:</p>
              <ul className="mt-1 space-y-1 text-slate-300 ml-4">
                <li>• Instalar dependências</li>
                <li>• Aplicar as migrações (tabelas <code>propostas</code> e <code>itens</code>)</li>
                <li>• Fazer o build do Next.js</li>
                <li>• Publicar em um domínio <code>.vercel.app</code></li>
              </ul>
            </Step>

            <Step n="3.5" title="Confira se ficou saudável">
              <p>Abra no navegador (troque pela sua URL):</p>
              <Code>{`https://comprasnet-bot.vercel.app/api/health`}</Code>
              <p className="text-slate-400 text-xs mt-2">
                Resposta esperada: <code className="text-green-400">{`{ "ok": true, "driver": "neon-http", "tables": { "propostas": true, "itens": true } }`}</code>
              </p>
            </Step>

            <div className="bg-green-900/40 border border-green-700 rounded-xl p-4 text-green-300">
              <p className="font-bold mb-1">✅ Sistema publicado!</p>
              <p className="text-sm">Seu app estará em: <code className="text-green-200">https://comprasnet-bot.vercel.app</code></p>
            </div>
          </div>
        </Section>

        {/* Step 4: Extension */}
        <Section n="4" color="bg-purple-900 text-white" title="🧩 Configurar a Extensão Chrome">
          <div className="space-y-4 text-sm">
            <Step n="4.1" title="Instale a extensão">
              <p>Baixe e instale conforme <Link href="/extensao" className="text-purple-300 hover:underline">instruções da extensão</Link></p>
            </Step>
            <Step n="4.2" title="Configure a URL do Vercel">
              <p>Abra a extensão → aba <strong>⚙️ Config</strong> → cole a URL do Vercel:</p>
              <Code>{`https://comprasnet-bot.vercel.app`}</Code>
            </Step>
            <Step n="4.3" title="Pronto para usar!">
              <p>Crie propostas no sistema Vercel, importe planilhas, preencha valores e execute o bot no ComprasNet.</p>
            </Step>
          </div>
        </Section>

        {/* Direct main flow */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6">
          <h3 className="font-bold text-emerald-800 mb-3 flex items-center gap-2">🚫 Sem PR — deploy pela integração do Vercel</h3>
          <p className="text-emerald-700 text-sm mb-4">
            Este repositório não contém um workflow de deploy do GitHub Actions. Para publicar sem PR, conecte o
            repositório ao Vercel e defina a branch de produção em <strong>Project Settings → Git</strong>.
          </p>

          <div className="space-y-5">
            <div>
              <p className="font-bold text-emerald-800 mb-2">Passo 1 — verificar a integração Git</p>
              <p className="text-sm text-emerald-700">
                No painel do Vercel, confirme que o repositório está conectado e que a branch de produção está correta
                (por exemplo, <code>main</code>). Não é preciso cadastrar <code>VERCEL_TOKEN</code>, <code>VERCEL_ORG_ID</code>
                ou <code>VERCEL_PROJECT_ID</code> no GitHub para esse fluxo.
              </p>
            </div>

            <div>
              <p className="font-bold text-emerald-800 mb-2">Passo 2 — publicar na branch configurada</p>
              <p className="text-sm text-emerald-700 mb-2">
                Faça commit e push estando na branch de produção configurada no Vercel (o exemplo abaixo usa <code>main</code>):
              </p>
              <Code dark={false}>{`git add -A
git commit -m "sua atualização"
git push origin main`}</Code>
              <p className="text-sm text-emerald-700 mt-2">
                O script opcional também verifica que você está na branch local <code>main</code> antes de enviar:
              </p>
              <Code dark={false}>{`bash scripts/publish-main.sh "sua atualização"`}</Code>
            </div>
          </div>
        </div>

        {/* Updates */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
          <h3 className="font-bold text-blue-800 mb-3 flex items-center gap-2">🔄 Como Atualizar o Sistema</h3>
          <p className="text-blue-700 text-sm mb-3">
            Com o repositório conectado ao Vercel, cada push na branch de produção configurada inicia um deploy automaticamente.
          </p>
          <Code dark={false}>{`git add -A
git commit -m "atualização"
git push origin main
# → Vercel recebe o push do Git
# → build aplica migrações e compila o app
# → deploy em produção ✅`}</Code>
        </div>

        {/* FAQ */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-4">❓ Perguntas Frequentes</h3>
          <div className="space-y-4 text-sm">
            {[
              { q: "É realmente gratuito?", a: "Sim! Vercel Hobby plan (gratuito), Neon Free tier (0.5GB storage, grátis), GitHub Free. Para uso pessoal/pequena empresa, tudo gratuito." },
              { q: "O Vercel suporta a extensão Chrome?", a: "A extensão roda NO SEU NAVEGADOR, não no servidor. O Vercel apenas hospeda a API que a extensão consulta para buscar os dados." },
              { q: "Posso usar um domínio próprio?", a: "Sim! No Vercel, vá em Settings → Domains → adicione seu domínio. É gratuito inclusive com domínios personalizados." },
              { q: "E se o Neon ficar fora do ar?", a: "O Neon tem 99.9% de uptime. Em caso de problema, o Vercel mostra o erro claramente nos logs." },
              { q: "Como proteger com senha?", a: "No Vercel, você pode adicionar autenticação com Vercel Password Protection (plano pago) ou implementar next-auth no código." },
              { q: "Deu erro `relation \"propostas\" does not exist`", a: "As tabelas não foram criadas. Rode `DATABASE_URL=... npm run db:migrate` localmente e refaça o deploy — ou confira se DATABASE_URL está marcada para o ambiente Production na Vercel." },
              { q: "Deu erro `DATABASE_URL is required` no build", a: "A variável não estava disponível durante o build. Agora o build não quebra mais sem ela, mas o app avisa na tela. Adicione DATABASE_URL nos 3 ambientes e faça Redeploy." },
              { q: "O build falhou em `[db:migrate]`", a: "Confira a string do Neon (senha, região, sslmode=require) e se o projeto Neon não está suspenso por inatividade. Dá para pular essa etapa com SKIP_DB_MIGRATIONS=1 e criar as tabelas depois." },
              { q: "Preciso trocar a senha do Neon depois de expor a URL?", a: "Sim, se a string vazou. No Neon: Project settings → Reset password. Depois atualize DATABASE_URL na Vercel e faça Redeploy." },
            ].map((faq) => (
              <div key={faq.q} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                <p className="font-bold text-slate-700 mb-1">❔ {faq.q}</p>
                <p className="text-slate-500">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center pb-4">
          <Link href="/" className="inline-flex items-center gap-2 bg-[#1351b4] hover:bg-[#0c326f] text-white px-8 py-3 rounded-xl font-bold transition">
            ← Ir para o Sistema
          </Link>
        </div>
      </main>
    </div>
  );
}

function Section({ n, color, title, children }: { n: string; color: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`${color} rounded-2xl overflow-hidden shadow-lg`}>
      <div className="px-6 py-4 border-b border-white/10">
        <h2 className="font-black text-xl flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-black">{n}</span>
          {title}
        </h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-xs font-bold text-slate-400 mt-0.5 shrink-0 w-8">{n}</span>
      <div>
        <p className="font-bold text-white mb-1">{title}</p>
        <div className="text-slate-300 space-y-1">{children}</div>
      </div>
    </div>
  );
}

function Code({ children, dark = true }: { children: string; dark?: boolean }) {
  return (
    <pre className={`${dark ? "bg-white/5 border-white/10 text-green-300" : "bg-slate-900 border-slate-700 text-green-400"} border rounded-xl p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap mt-2`}>
      {children}
    </pre>
  );
}
