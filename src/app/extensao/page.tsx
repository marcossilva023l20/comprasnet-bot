import Link from "next/link";

export default function ExtensaoPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-[#1351b4] text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-blue-200 hover:text-white text-sm">← Voltar</Link>
            <span className="text-blue-300">›</span>
            <h1 className="font-bold">🧩 Extensão Chrome</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-10 space-y-8">
        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="text-6xl">🤖</div>
          <h1 className="text-3xl font-black text-slate-800">Extensão Chrome ComprasNet Bot</h1>
          <p className="text-slate-500 max-w-xl mx-auto">
            Uma extensão que roda <strong>no seu próprio navegador</strong>, lê os dados do sistema e preenche os campos do ComprasNet automaticamente — sem necessidade de servidor externo.
          </p>
        </div>

        {/* Download */}
        <div className="bg-gradient-to-br from-[#1351b4] to-[#0c326f] rounded-2xl p-8 text-white text-center shadow-xl shadow-blue-900/30">
          <h2 className="text-xl font-bold mb-2">📦 Baixar Extensão</h2>
          <p className="text-blue-200 text-sm mb-6">Arquivo ZIP pronto para instalar no Chrome</p>
          <a
            href="/extension.zip"
            download
            className="inline-flex items-center gap-3 bg-white text-[#1351b4] font-black px-8 py-3.5 rounded-xl hover:bg-blue-50 transition text-base shadow-lg"
          >
            ⬇️ Baixar comprasnet-bot.zip
          </a>
          <p className="text-xs text-blue-300 mt-4">Compatível com Google Chrome, Microsoft Edge e Brave</p>
        </div>

        {/* Install Steps */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
            <h2 className="font-black text-slate-800 text-lg flex items-center gap-2">🔧 Como Instalar</h2>
            {[
              { n: "1", title: "Baixe o arquivo ZIP", desc: 'Clique no botão acima para baixar "comprasnet-bot.zip"' },
              { n: "2", title: "Extraia o ZIP", desc: "Clique com botão direito → Extrair aqui. Anote a pasta criada." },
              { n: "3", title: "Abra as extensões do Chrome", desc: 'Acesse chrome://extensions ou Menu → Mais ferramentas → Extensões' },
              { n: "4", title: "Ative o Modo Desenvolvedor", desc: "Clique no toggle no canto superior direito da página" },
              { n: "5", title: 'Clique em "Carregar sem compactação"', desc: "Selecione a pasta extraída (comprasnet-bot)" },
              { n: "6", title: "Pronto! ✅", desc: "O ícone 🤖 aparece na barra do Chrome" },
            ].map((s) => (
              <div key={s.n} className="flex gap-3">
                <span className="w-7 h-7 rounded-full bg-[#1351b4] text-white text-xs font-black flex items-center justify-center shrink-0">{s.n}</span>
                <div>
                  <p className="font-bold text-slate-700 text-sm">{s.title}</p>
                  <p className="text-xs text-slate-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
            <h2 className="font-black text-slate-800 text-lg flex items-center gap-2">🚀 Como Usar</h2>
            {[
              { n: "1", icon: "📥", title: "Importe os itens da página", desc: "No popup, use \"Ler itens da página\" e envie: o sistema cria a proposta e grava os itens lidos" },
              { n: "2", icon: "📋", title: "Complete valor, marca e modelo", desc: "Abra a proposta no sistema e preencha o que o ComprasNet não mostra" },
              { n: "3", icon: "🏛️", title: "Acesse o ComprasNet", desc: "Faça login e vá em Dispensa Eletrônica → Cadastrar Propostas" },
              { n: "4", icon: "🧩", title: "Abra a extensão", desc: 'Clique no ícone 🤖 na barra do Chrome, vá em "⚙️ Config" e cole a URL do sistema' },
              { n: "5", icon: "📦", title: "Selecione a proposta e itens", desc: "Escolha quais itens preencher (só os com dados completos aparecerão)" },
              { n: "6", icon: "📖", title: 'Clique "Ler página"', desc: "Expanda os itens no ComprasNet e confira se valor, marca e modelo foram encontrados" },
              { n: "7", icon: "🚀", title: 'Clique "Executar Bot"', desc: "O bot preenche os campos reconhecidos para cada item! ✨" },
            ].map((s) => (
              <div key={s.n} className="flex gap-3">
                <span className="w-7 h-7 rounded-full bg-green-500 text-white text-xs font-black flex items-center justify-center shrink-0">{s.n}</span>
                <div>
                  <p className="font-bold text-slate-700 text-sm">{s.icon} {s.title}</p>
                  <p className="text-xs text-slate-500">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Config URL */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
          <h3 className="font-bold text-amber-800 mb-2 flex items-center gap-2">⚙️ Configurar URL do Sistema</h3>
          <p className="text-amber-700 text-sm mb-3">
            Na aba <strong>⚙️ Config</strong> da extensão, cole a URL onde o sistema está rodando:
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="bg-white border border-amber-200 rounded-xl p-3">
              <p className="text-xs font-bold text-amber-700 mb-1">🏠 Em desenvolvimento (local)</p>
              <code className="text-xs text-slate-700 font-mono">http://localhost:3000</code>
            </div>
            <div className="bg-white border border-amber-200 rounded-xl p-3">
              <p className="text-xs font-bold text-amber-700 mb-1">☁️ Em produção (Vercel)</p>
              <code className="text-xs text-slate-700 font-mono">https://seu-app.vercel.app</code>
            </div>
          </div>
        </div>

        {/* Tips */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
          <h3 className="font-bold text-blue-800 mb-3 flex items-center gap-2">💡 Dicas importantes</h3>
          <ul className="space-y-2 text-sm text-blue-700">
            <li>✅ <strong>Expanda os itens</strong> e use &quot;Ler página&quot; antes de executar; confira se valor, marca e modelo foram encontrados</li>
            <li>📥 <strong>Ler itens da página</strong> traz número, descrição, quantidade, unidade e valor estimado direto do ComprasNet — e <strong>substitui</strong> os itens da proposta correspondente (UASG + nº da compra)</li>
            <li>✅ O bot só preenche campos que conseguiu associar com segurança a um item</li>
            <li>✅ Use <strong>delay &quot;Lento&quot;</strong> se o site estiver demorando para responder</li>
            <li>✅ O bot só preenche itens que <strong>tenham Valor Unitário e Marca</strong> cadastrados no sistema</li>
            <li>⚠️ Se aparecer CAPTCHA, resolva manualmente e continue</li>
            <li>⚠️ Se a extensão avisar que não encontrou &quot;Salvar&quot;, confira manualmente se o item foi gravado</li>
            <li>🌐 Usando <strong>domínio próprio</strong> na Vercel? Adicione o endereço em <code className="bg-white/70 px-1 rounded">host_permissions</code> do <code className="bg-white/70 px-1 rounded">manifest.json</code> antes de carregar a extensão</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
