import Link from "next/link";
import VersoesExtensao from "@/components/VersoesExtensao";

export default function ExtensaoPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-[#6d28d9] text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-purple-200 hover:text-white text-sm">← Voltar</Link>
            <span className="text-purple-300">›</span>
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
        <div className="bg-gradient-to-br from-[#6d28d9] to-[#4c1d95] rounded-2xl p-8 text-white text-center shadow-xl shadow-purple-900/30">
          <h2 className="text-xl font-bold mb-2">📦 Baixar Extensão</h2>
          <p className="text-purple-200 text-sm mb-6">Arquivo ZIP pronto para instalar no Chrome</p>
          <a
            href="/extension.zip"
            download
            className="inline-flex items-center gap-3 bg-white text-[#6d28d9] font-black px-8 py-3.5 rounded-xl hover:bg-purple-50 transition text-base shadow-lg"
          >
            ⬇️ Baixar comprasnet-bot.zip
          </a>
          <p className="text-xs text-purple-300 mt-4">Versão estável recomendada: 1.7.20. O Modo Disputa 1.8.8 BETA pode enviar lances reais quando confirma o polegar vermelho para baixo; ainda não foi validado numa sessão real.</p>
          <p className="text-xs text-purple-300 mt-4">
            Compatível com Google Chrome, Microsoft Edge e Brave · <strong>instalação única</strong>: depois disso, a própria extensão avisa e atualiza
          </p>
        </div>

        <VersoesExtensao />

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
              { n: "6", title: "Pronto! ✅", desc: "O ícone 🤖 aparece na barra do Chrome — e o ZIP nunca mais é necessário" },
            ].map((s) => (
              <div key={s.n} className="flex gap-3">
                <span className="w-7 h-7 rounded-full bg-[#6d28d9] text-white text-xs font-black flex items-center justify-center shrink-0">{s.n}</span>
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
              { n: "1", icon: "🧩", title: "Configure a extensão", desc: 'Clique no ícone 🤖 na barra do Chrome, vá em "⚙️ Config" e cole a URL do sistema' },
              { n: "2", icon: "📥", title: "Importe itens de uma fonte pública", desc: "No CNET Mobile, pesquise a unidade e a compra e clique em Acompanhar compra; no Radar PNCP, abra Ver detalhes. Use \"Ler itens da página\" no popup e confirme o envio" },
              { n: "3", icon: "📋", title: "Complete valor, marca e modelo", desc: "Abra a proposta no sistema e preencha o que a fonte pública não informa" },
              { n: "4", icon: "🏛️", title: "Acesse o ComprasNet", desc: "Faça login e vá em Dispensa Eletrônica → Cadastrar Propostas" },
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

        {/* Como atualizar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="font-black text-slate-800 text-lg flex items-center gap-2">🔄 Como atualizar a extensão</h2>
          <p className="text-sm text-slate-600">
            Sempre que o sistema for atualizado, <strong>não é preciso baixar o ZIP outra vez</strong>. A extensão verifica a versão publicada
            (o ícone 🤖 ganha um &quot;!&quot; quando há novidade) e atualiza em um clique:
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { n: "1", icon: "⚙️", title: "Abra o popup → ⚙️ Config", desc: 'Clique em "🔄 Verificar": a extensão mostra a versão publicada e o que mudou' },
              { n: "2", icon: "⚡", title: 'Clique em "⚡ Atualizar"', desc: "Na primeira vez, escolha a pasta que você carregou em chrome://extensions (o Chrome pede essa permissão só uma vez)" },
              { n: "3", icon: "♻️", title: "Recarregue", desc: "A extensão grava os arquivos novos na pasta e recarrega sozinha — pronto, está na versão mais recente" },
            ].map((s) => (
              <div key={s.n} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="font-bold text-slate-700 text-sm mb-1">{s.icon} {s.title}</p>
                <p className="text-xs text-slate-500">{s.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
            ℹ️ O Chrome não permite que uma extensão instalada &quot;sem compactação&quot; se atualize <em>sozinha</em> — isso só existe para extensões
            publicadas na Chrome Web Store. Por isso o clique em <strong>⚡ Atualizar</strong> é necessário; ele grava os arquivos na sua pasta e
            recarrega. O ZIP continua disponível como alternativa manual (baixe, extraia sobre a pasta e clique em &quot;Recarregar&quot;).
          </p>
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
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-6">
          <h3 className="font-bold text-purple-800 mb-3 flex items-center gap-2">💡 Dicas importantes</h3>
          <ul className="space-y-2 text-sm text-purple-700">
            <li>✅ <strong>Expanda os itens</strong> e use &quot;Ler página&quot; antes de executar; confira se valor, marca e modelo foram encontrados</li>
            <li>📥 <strong>Ler itens da página</strong> também aceita CNET Mobile/Compras.gov.br e Radar PNCP; lê número, descrição, quantidade, unidade e valor estimado e <strong>substitui</strong> os itens da proposta correspondente</li>
            <li>✅ O bot só preenche campos que conseguiu associar com segurança a um item</li>
            <li>✅ Use <strong>delay &quot;Lento&quot;</strong> se o site estiver demorando para responder</li>
            <li>✅ O bot só preenche itens que <strong>tenham Valor Unitário e Marca</strong> cadastrados no sistema</li>
            <li>⚔️ <strong>Modo Disputa 1.8.8 BETA:</strong> só envia quando confirma o polegar vermelho para baixo; polegar verde ou estado incerto bloqueia o lance. Confere o Valor Mínimo atualizado antes do clique. A validação numa disputa real ainda está pendente; use a versão estável 1.7.20 se não deseja envio automático.</li>
            <li>⚠️ Se aparecer CAPTCHA, resolva manualmente e continue</li>
            <li>⚠️ Se a extensão avisar que não encontrou &quot;Salvar&quot;, confira manualmente se o item foi gravado</li>
            <li>🔄 <strong>Manter atualizada</strong>: aba ⚙️ → &quot;🔄 Verificar&quot; → &quot;⚡ Atualizar&quot; (a pasta da extensão é pedida só na primeira vez)</li>
            <li>🌐 Usando <strong>domínio próprio</strong> na Vercel? Adicione o endereço em <code className="bg-white/70 px-1 rounded">host_permissions</code> do <code className="bg-white/70 px-1 rounded">manifest.json</code> antes de carregar a extensão</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
