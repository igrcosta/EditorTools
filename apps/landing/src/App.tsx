import { useEffect, useState, type CSSProperties } from 'react';
import { DotField } from '../../web/src/components/DotField';
import { Reveal } from '../../web/src/components/Reveal';
import { BeforeAfterSlider, Button, Eyebrow, LoopVideo, SectionTitle } from './components';
import {
  CHECKOUT_URL,
  DOWNLOAD_URL,
  FAQ,
  FREE_FEATURES,
  PRICE,
  PRO_FEATURES,
  STEPS,
  SUPPORT_EMAIL,
  TOOLS,
} from './content';

const NAV = [
  { href: '#ferramentas', label: 'Ferramentas' },
  { href: '#demonstracao', label: 'Veja funcionando' },
  { href: '#precos', label: 'Preços' },
  { href: '#perguntas', label: 'Perguntas' },
];

function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-4 pt-4">
      <div
        className={`pointer-events-auto flex h-12 items-center gap-2 rounded-full border bg-zinc-950/90 py-1 pr-1.5 pl-4 backdrop-blur-xl transition-[border-color,box-shadow] duration-300 ${
          scrolled ? 'border-white/15 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)]' : 'border-white/10 shadow-[0_8px_30px_-16px_rgba(0,0,0,0.8)]'
        }`}
      >
        <a href="#" className="flex items-center gap-2 pr-3 font-display text-sm tracking-[0.06em] text-zinc-100">
          <img src="/logo-mark.png" alt="" className="h-5 w-auto" width={32} height={24} />
          <span className="hidden sm:inline">EDITOOLS</span>
        </a>
        <nav className="hidden items-center md:flex" aria-label="Seções">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="rounded-full px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-100">
              {item.label}
            </a>
          ))}
        </nav>
        <a href="#precos" className="btn-primary ml-1 rounded-full px-5 py-2 text-sm font-semibold text-white">
          Assinar Pro
        </a>
      </div>
    </header>
  );
}

function HeroTitle({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <h1 className="mt-7 max-w-4xl font-display text-5xl leading-[0.98] [text-shadow:0_2px_24px_rgba(0,0,0,0.9)] sm:text-7xl">
      {text.split(' ').map((word, i) => (
        <span
          key={`${word}-${i}`}
          className="reveal mr-[0.22em] inline-block text-white last:mr-0"
          data-in={shown}
          style={{ '--reveal-delay': `${120 + i * 90}ms`, '--reveal-distance': '28px', '--reveal-blur': '10px' } as CSSProperties}
        >
          {word}
        </span>
      ))}
    </h1>
  );
}

function Hero() {
  return (
    <section className="relative flex min-h-[min(92svh,900px)] items-center justify-center overflow-hidden bg-black">
      <DotField className="absolute inset-0" speed={1.4} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.8)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_40%_32%_at_50%_55%,rgba(0,0,0,0.68)_0%,rgba(0,0,0,0.42)_60%,transparent_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-zinc-950" />

      <div className="relative z-10 flex flex-col items-center px-4 pt-28 pb-24 text-center">
        <img
          src="/logo-mark.png"
          alt="Editools"
          width={116}
          height={88}
          className="h-[72px] w-auto"
          style={{ filter: 'drop-shadow(0 0 28px rgba(132,77,234,0.55))' }}
        />
        <Reveal delay={60} className="mt-7">
          <span className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-zinc-950/80 py-1.5 pr-4 pl-3 text-xs text-zinc-200 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="pulse-ring absolute inset-0 rounded-full bg-accent-text" />
              <span className="relative h-2 w-2 rounded-full bg-accent-text" />
            </span>
            App para Windows · roda no seu computador
          </span>
        </Reveal>
        <HeroTitle text="Todas as ferramentas. Um app." />
        <Reveal delay={620} className="mt-6 max-w-2xl">
          <p className="text-lg text-white [text-shadow:0_1px_14px_rgba(0,0,0,1),0_0_4px_rgba(0,0,0,0.9)]">
            Baixe, converta, limpe áudio, remova fundo, reenquadre e legende. Tudo no seu computador.
          </p>
        </Reveal>
        <Reveal delay={740} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button href="#precos">
            Assinar Pro · <span className="opacity-70 line-through">R$ {PRICE.regular}</span> R$ {PRICE.launch}/mês
            <i className="fi-rr-arrow-small-right text-base" aria-hidden="true" />
          </Button>
          <Button variant="ghost" href="#baixar" className="!bg-zinc-950">
            Baixar grátis
          </Button>
        </Reveal>
        <Reveal delay={860} className="mt-4">
          <p className="text-xs text-zinc-200 [text-shadow:0_1px_8px_rgba(0,0,0,1)]">Plano grátis disponível · desconto de inauguração no Pro</p>
        </Reveal>
      </div>
    </section>
  );
}

function Tools() {
  return (
    <section id="ferramentas" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 pt-8 pb-28">
      <SectionTitle
        eyebrow="Ferramentas"
        title="Tudo o que você edita, em uma janela."
        subtitle="Oito ferramentas no mesmo app, com o mesmo jeito simples de usar: arraste o arquivo, ajuste uma opção e pronto."
      />
      <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((tool, i) => (
          <Reveal key={tool.title} delay={(i % 4) * 70}>
            <div className="spotlight panel group relative flex h-full min-h-60 flex-col rounded-2xl p-6 transition-transform duration-300 ease-[var(--ease-reveal)] hover:-translate-y-1">
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-xl text-accent-text shadow-[0_0_28px_-8px_rgba(145,70,255,0.9)]">
                <i className={tool.icon} aria-hidden="true" />
              </span>
              <h3 className="mt-6 text-lg font-semibold tracking-tight text-zinc-100">{tool.title}</h3>
              <p className="mt-1.5 text-sm text-zinc-400">{tool.body}</p>
              <ul className="mt-auto flex flex-wrap gap-1.5 pt-5">
                {tool.tags.map((tag) => (
                  <li key={tag} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-xs text-zinc-400">
                    {tag}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Demos() {
  return (
    <section id="demonstracao" className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 pb-28">
      <SectionTitle
        eyebrow="Veja funcionando"
        title="Resultados reais, feitos no app."
        subtitle="Estes exemplos foram gerados pelo próprio Editools, sem edição depois."
      />
      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        <Reveal>
          <div className="panel flex h-full flex-col rounded-2xl p-5">
            <div className="demo-stage my-auto grid grid-cols-[256fr_81fr] gap-3">
              <div className="aspect-video overflow-hidden rounded-lg bg-black">
                <LoopVideo src="/demo/vlog-original.mp4" poster="/demo/vlog-original-poster.jpg" label="Vídeo original na horizontal" />
              </div>
              <div className="overflow-hidden rounded-lg bg-black">
                <LoopVideo src="/demo/vlog-tracked.mp4" poster="/demo/vlog-tracked-poster.jpg" label="Mesmo vídeo reenquadrado na vertical, seguindo o rosto" />
              </div>
            </div>
            <h3 className="mt-5 text-lg font-semibold text-zinc-100">O quadro segue o rosto</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Do vídeo horizontal (à esquerda) para o vertical 9:16 (à direita), com a pessoa enquadrada o tempo todo.
            </p>
          </div>
        </Reveal>
        <Reveal delay={90}>
          <div className="panel flex h-full flex-col rounded-2xl p-5">
            <BeforeAfterSlider
              before="/demo/car-original.jpg"
              after="/demo/car-cutout.webp"
              beforeLabel="Original"
              afterLabel="Fundo removido"
              alt="Foto de um carro branco; arraste o controle para ver o fundo removido"
            />
            <h3 className="mt-5 text-lg font-semibold text-zinc-100">Recorte limpo em um clique</h3>
            <p className="mt-1 text-sm text-zinc-400">Arraste o controle para comparar a foto original com o recorte sem fundo.</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Privacy() {
  const items = [
    {
      icon: 'fi-rr-laptop',
      title: 'Roda no seu computador',
      body: 'O processamento e a inteligência artificial rodam localmente. Seus arquivos nunca são enviados.',
    },
    {
      icon: 'fi-rr-user',
      title: 'Grátis para começar',
      body: 'Entre só com o e-mail, sem senha. O plano grátis traz todas as ferramentas com um limite diário; o Pro remove o limite.',
    },
    {
      icon: 'fi-rr-shield-check',
      title: 'Dados de uso, com honestidade',
      body: 'Contamos quais ferramentas são usadas, nunca seus arquivos, links, textos ou e-mail. Você pode desligar quando quiser.',
    },
  ];
  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-28">
      <SectionTitle eyebrow="Privado por padrão" title="Seus arquivos continuam seus." />
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {items.map((item, i) => (
          <Reveal key={item.title} delay={i * 80}>
            <div className="panel h-full rounded-2xl p-6">
              <i className={`${item.icon} text-2xl text-accent-text`} aria-hidden="true" />
              <p className="mt-6 text-lg font-semibold text-zinc-100">{item.title}</p>
              <p className="mt-1.5 text-sm text-zinc-400">{item.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="precos" className="mx-auto w-full max-w-5xl scroll-mt-24 px-4 pb-28">
      <SectionTitle
        eyebrow="Planos"
        title="Comece grátis. Assine quando precisar de mais."
        subtitle="As mesmas ferramentas nos dois planos. O Pro tira os limites."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-2">
        <Reveal>
          <div className="panel flex h-full flex-col rounded-2xl p-7">
            <p className="font-display text-xl text-zinc-100">Grátis</p>
            <p className="mt-4 text-4xl font-semibold text-zinc-100">
              R$ 0<span className="ml-1 text-base font-normal text-zinc-500">/mês</span>
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-zinc-300">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <i className="fi-rr-check mt-0.5 text-accent-text" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-8">
              <Button variant="ghost" href="#baixar" className="w-full">
                Baixar grátis
              </Button>
            </div>
          </div>
        </Reveal>

        <Reveal delay={90}>
          <div className="panel relative flex h-full flex-col rounded-2xl border border-accent/50 p-7 shadow-[0_0_60px_-20px_rgba(145,70,255,0.7)]">
            <span className="absolute -top-3 left-7 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">
              Desconto de inauguração
            </span>
            <p className="font-display text-xl text-zinc-100">Pro</p>
            <p className="mt-4 flex items-baseline gap-3">
              <span className="text-lg text-zinc-500 line-through" aria-label={`De R$ ${PRICE.regular}`}>
                R$ {PRICE.regular}
              </span>
              <span className="text-4xl font-semibold text-zinc-100">
                R$ {PRICE.launch}
                <span className="ml-1 text-base font-normal text-zinc-500">/mês</span>
              </span>
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-zinc-300">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex gap-2.5">
                  <i className="fi-rr-check mt-0.5 text-accent-text" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-8">
              <Button href={CHECKOUT_URL} disabled={!CHECKOUT_URL} className="w-full">
                {CHECKOUT_URL ? 'Assinar o Pro' : 'Assinatura em breve'}
              </Button>
              <p className="mt-3 text-center text-xs text-zinc-500">
                Cartão (cobrança automática), Pix ou boleto (renovação manual todo mês). Use o mesmo e-mail com que você entra no app.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Download() {
  return (
    <section id="baixar" className="mx-auto w-full max-w-5xl scroll-mt-24 px-4 pb-28">
      <SectionTitle eyebrow="Comece agora" title="Baixe, instale, edite." />
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <Reveal key={step.title} delay={i * 80}>
            <div className="panel h-full rounded-2xl p-6">
              <span className="font-display text-3xl text-accent-text">{i + 1}</span>
              <p className="mt-4 text-lg font-semibold text-zinc-100">{step.title}</p>
              <p className="mt-1.5 text-sm text-zinc-400">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-10 flex flex-col items-center gap-3 text-center">
        <Button href={DOWNLOAD_URL} disabled={!DOWNLOAD_URL}>
          <i className="fi-rr-download text-base" aria-hidden="true" />
          {DOWNLOAD_URL ? 'Baixar para Windows' : 'Download em breve'}
        </Button>
        <p className="max-w-md text-xs text-zinc-500">
          Windows 10 ou 11. O Windows pode mostrar um aviso na primeira instalação porque o instalador ainda não tem assinatura digital; veja a
          pergunta abaixo.
        </p>
      </Reveal>
    </section>
  );
}

function Faq() {
  return (
    <section id="perguntas" className="mx-auto w-full max-w-3xl scroll-mt-24 px-4 pb-28">
      <SectionTitle eyebrow="Perguntas frequentes" title="Antes de assinar." />
      <div className="mt-14 space-y-3">
        {FAQ.map((item) => (
          <Reveal key={item.q}>
            <details className="panel group rounded-xl p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-zinc-100 [&::-webkit-details-marker]:hidden">
                {item.q}
                <i className="fi-rr-arrow-down text-sm text-zinc-500 transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-xs text-zinc-500">
        <Eyebrow>Editools</Eyebrow>
        <p>© {new Date().getFullYear()} Editools. Todos os direitos reservados.</p>
        {SUPPORT_EMAIL && (
          <p>
            Suporte:{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-zinc-300">
              {SUPPORT_EMAIL}
            </a>
          </p>
        )}
        <p>
          Ícones:{' '}
          <a href="https://www.flaticon.com/uicons" target="_blank" rel="noreferrer" className="underline hover:text-zinc-300">
            Flaticon UIcons
          </a>
        </p>
      </div>
    </footer>
  );
}

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 flex-col">
        <Hero />
        <Tools />
        <Demos />
        <Privacy />
        <Pricing />
        <Download />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
