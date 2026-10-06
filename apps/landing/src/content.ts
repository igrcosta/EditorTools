import { DEFAULT_PLAN_LIMITS } from '@editools/shared';

// Everything the owner may need to change lives here or in the three build-time variables below.

/** Set VITE_CHECKOUT_URL at build time once the Kiwify product exists; until then the button says "em breve". */
export const CHECKOUT_URL = (import.meta.env.VITE_CHECKOUT_URL as string | undefined) ?? '';
/** Set VITE_DOWNLOAD_URL to the GitHub Releases link of the installer. */
export const DOWNLOAD_URL = (import.meta.env.VITE_DOWNLOAD_URL as string | undefined) ?? '';
/** Set VITE_SUPPORT_EMAIL; the contact line stays hidden until it is. */
export const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined) ?? '';

export const PRICE = { regular: 40, launch: 35 } as const;

// The free-plan numbers come from the same table the app enforces, so this page cannot drift from it.
const free = DEFAULT_PLAN_LIMITS.free;
const minutes = (s: number | null) => (s === null ? 0 : Math.round(s / 60));
const megabytes = (b: number | null) => (b === null ? 0 : Math.round(b / 1024 ** 2));

export const FREE_FEATURES = [
  'Todas as ferramentas liberadas',
  `${free.dailyRuns} usos por dia`,
  `Arquivos de até ${minutes(free.maxMediaSeconds)} minutos`,
  `Arquivos de até ${megabytes(free.maxUploadBytes)} MB`,
  `Downloads em até ${free.maxDownloadHeight}p`,
  `Upscale em ${free.allowedUpscaleScales?.map((s) => `×${s}`).join(', ')}`,
];

export const PRO_FEATURES = [
  'Todas as ferramentas liberadas',
  'Sem limite diário de usos',
  'Arquivos longos, sem limite de duração ou tamanho',
  'Downloads na melhor qualidade disponível',
  'Upscale em todos os tamanhos',
  'Atualizações e novas ferramentas incluídas',
];

export interface Tool {
  icon: string;
  title: string;
  body: string;
  tags: string[];
}

export const TOOLS: Tool[] = [
  {
    icon: 'fi-rr-folder-download',
    title: 'Baixar mídia',
    body: 'Cole o link de um vídeo ou áudio e salve no formato e na qualidade que você escolher.',
    tags: ['Vídeo', 'Áudio', 'Escolha de qualidade'],
  },
  {
    icon: 'fi-rr-refresh',
    title: 'Conversor e extrator de áudio',
    body: 'Converta entre os formatos que você usa e extraia o áudio de qualquer vídeo, sem abrir outro programa.',
    tags: ['MP4', 'MOV', 'MKV', 'WEBM', 'MP3', 'WAV'],
  },
  {
    icon: 'fi-rr-waveform',
    title: 'Cortar silêncio e aparar',
    body: 'Veja as partes em silêncio, remova tudo automaticamente e apare o início e o fim.',
    tags: ['Prévia dos cortes', 'Automático'],
  },
  {
    icon: 'fi-rr-volume',
    title: 'Corrigir áudio',
    body: 'Reduz ruído e deixa o volume parelho, para a fala ficar clara do começo ao fim.',
    tags: ['Redução de ruído', 'Volume nivelado'],
  },
  {
    icon: 'fi-rr-picture',
    title: 'Remover fundo',
    body: 'Recorte o assunto de uma imagem em um clique, com inteligência artificial rodando no seu computador.',
    tags: ['IA local', 'PNG com transparência'],
  },
  {
    icon: 'fi-rr-expand-arrows-alt',
    title: 'Aumentar resolução',
    body: 'Amplie imagens pequenas com IA e compare o antes e o depois. Precisa de placa de vídeo com suporte a Vulkan.',
    tags: ['IA local', '×2 e ×4', 'Antes e depois'],
  },
  {
    icon: 'fi-rr-face-viewfinder',
    title: 'Face Tracking',
    body: 'Transforme um vídeo horizontal em vertical com o rosto sempre enquadrado, no ponto que você escolher.',
    tags: ['Reenquadramento', '9:16', 'Escolha de quem seguir'],
  },
  {
    icon: 'fi-rr-subtitles',
    title: 'Legendas automáticas',
    body: 'Transcreva a fala no seu computador, corrija qualquer palavra, escolha um estilo e grave as legendas no vídeo.',
    tags: ['Fala para texto local', 'Vários idiomas', 'Estilos prontos'],
  },
];

export const STEPS = [
  { title: 'Baixe e instale', body: 'Instalador para Windows. Sem cadastro para baixar.' },
  { title: 'Entre com o seu e-mail', body: 'Você recebe um código de 6 dígitos. Sem senha para lembrar.' },
  { title: 'Arraste o arquivo', body: 'Escolha a ferramenta, ajuste uma ou duas opções e pronto.' },
];

export const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Meus arquivos são enviados para algum servidor?',
    a: 'Não. O processamento e os modelos de IA rodam no seu computador. Só a sua conta, o seu plano e contagens anônimas de uso (quais ferramentas são usadas, nunca nomes de arquivos, links, textos ou o seu e-mail) vão para os nossos servidores. Você pode desligar as contagens de uso quando quiser.',
  },
  {
    q: 'Preciso de internet para usar?',
    a: 'Para entrar e confirmar o seu plano, sim. Depois disso, as ferramentas processam no seu computador e o app continua funcionando por alguns dias sem conexão. Baixar mídia, claro, precisa de internet.',
  },
  {
    q: 'Qual a diferença entre o plano grátis e o Pro?',
    a: 'Todas as ferramentas estão nos dois. O plano grátis tem limites diários e por arquivo (veja a tabela de planos). O Pro remove esses limites.',
  },
  {
    q: 'Como funciona o pagamento?',
    a: 'A assinatura é mensal, processada pela Kiwify. No cartão de crédito a cobrança é automática. No Pix e no boleto você renova manualmente todo mês: a Kiwify manda lembretes antes do vencimento e dá alguns dias de tolerância. Use no pagamento o mesmo e-mail com que você entra no app.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim. Você mantém o Pro até o fim do período que já pagou.',
  },
  {
    q: 'O Windows avisa que o instalador é de um editor desconhecido. É seguro?',
    a: 'O instalador ainda não tem assinatura digital paga, então o Windows SmartScreen pode mostrar um aviso. Clique em "Mais informações" e depois em "Executar assim mesmo". Baixe sempre apenas deste site ou da página oficial de versões no GitHub.',
  },
  {
    q: 'Funciona em Mac ou Linux?',
    a: 'Por enquanto, apenas Windows.',
  },
  {
    q: 'Posso baixar qualquer vídeo?',
    a: 'A ferramenta de download é para conteúdo seu ou que você tem autorização para usar. Você é responsável por respeitar os direitos autorais e os termos das plataformas.',
  },
  {
    q: 'O aumento de resolução e as legendas funcionam em qualquer computador?',
    a: 'As legendas rodam no processador. O aumento de resolução com IA precisa de uma placa de vídeo com suporte a Vulkan; sem ela, a ferramenta avisa em vez de falhar no meio.',
  },
];
