/**
 * Il giro di Wrambi: per ogni parte dell'app a cosa serve, come si usa e
 * come lo fa Wrambi. Si apre da solo la prima volta e poi dal menu ⋯.
 *
 * Le frasi sono chiavi di traduzione (italiano); i tasti si scrivono come
 * segnaposto ({note}) e si mostrano nella forma del sistema (⌘ su Mac).
 */
import { tk } from './i18n/keys';
import { hideHome, showHome } from './home.svelte';
import { ui } from './state.svelte';

export interface TourLine {
  text: string;
  keys?: Record<string, string>;
}

export interface TourStep {
  id: string;
  /** Elemento da mettere in luce (attributo data-tour). */
  target?: string;
  title: string;
  lead: TourLine;
  how?: TourLine[];
  /** Come lo fa Wrambi, dietro le quinte. */
  inside?: TourLine;
  /** Prepara l'interfaccia per questo passo. */
  enter?: () => void;
}

const line = (text: string, keys?: Record<string, string>): TourLine => ({ text, keys });

export const TOUR: TourStep[] = [
  {
    id: 'welcome',
    title: tk('Benvenuto in Wrambi'),
    lead: line(tk('Wrambi tiene in una sola finestra quello che di solito è sparso in quattro programmi: i documenti da leggere, le note, le citazioni e il testo che stai scrivendo. Così quello che pensi mentre leggi resta attaccato alle parole che lo hanno fatto nascere, e lo ritrovi quando scrivi.')),
    inside: line(tk('Funziona senza Internet e senza account. I tuoi file restano dove sono, in formati normali: Wrambi non li sposta e non li carica da nessuna parte.')),
    enter: () => hideHome(),
  },
  {
    id: 'page',
    target: 'page',
    title: tk('La pagina'),
    lead: line(tk('Qui si scrive: una pagina sola, senza distrazioni. La struttura del testo si vede, i segni del Markdown restano tenui.')),
    how: [
      line(tk('Scrivi e basta: Wrambi salva da solo appena ti fermi.')),
      line(tk('Titoli, grassetto, elenchi, citazioni dalla barra in alto, oppure con {bold}, {h1}, {list}.'), { bold: 'Ctrl+B', h1: 'Ctrl+1', list: 'Ctrl+Shift+8' }),
      line(tk('{focus} lascia solo la pagina: è la modalità Focus.'), { focus: 'Ctrl+Shift+F' }),
    ],
    inside: line(tk('Il testo è Markdown, cioè testo semplice: lo apre qualunque programma, oggi e fra trent\'anni. Ogni salvataggio scrive prima una copia e poi la sostituisce all\'originale, così un\'interruzione non lascia mai un file a metà.')),
    enter: () => hideHome(),
  },
  {
    id: 'notes',
    target: 'note',
    title: tk('Note sul testo'),
    lead: line(tk('Una nota è un pensiero attaccato alle parole esatte da cui è nato: il passo diventa rosso e la nota si apre come una nota a piè di pagina.')),
    how: [
      line(tk('Seleziona un passo e premi {note}, oppure «Nota».'), { note: 'Ctrl+M' }),
      line(tk('Per evidenziare senza scrivere nulla: {hl}. Nei documenti da leggere, selezionando compare anche un piccolo menu.'), { hl: 'Ctrl+Shift+H' }),
      line(tk('Tutte le note, di tutti i documenti, sono in un posto solo ({all}): si cercano, si riaprono, si esportano.'), { all: 'Ctrl+Shift+N' }),
    ],
    inside: line(tk('Wrambi ricorda il passo annotato insieme a un po\' di contesto prima e dopo: se il testo cambia, anche fuori da Wrambi, la nota lo ritrova. Le note non vengono scritte dentro i tuoi file; quando esporti un documento possono diventare vere note a piè di pagina.')),
  },
  {
    id: 'cite',
    target: 'cite',
    title: tk('Citazioni'),
    lead: line(tk('Le citazioni arrivano dalla tua bibliografia, per esempio quella di Zotero, e si impaginano da sole in ogni formato.')),
    how: [
      line(tk('Nelle Impostazioni scegli il file della bibliografia (.bib o CSL JSON). Da Zotero conviene esportarlo con Better BibTeX e «Mantieni aggiornato».')),
      line(tk('Premi {cite}, cerca un autore o un titolo, aggiungi la pagina se serve.'), { cite: 'Ctrl+Shift+C' }),
      line(tk('Mentre scrivi, dopo @ Wrambi suggerisce le opere.')),
    ],
    inside: line(tk('Nel testo resta la sintassi di Pandoc, per esempio [@rossi2020, p. 33], che altri programmi capiscono. In HTML, EPUB, testo e anteprima Wrambi formatta le citazioni in stile autore-anno; in PDF e Typst diventano citazioni di Typst, in LaTeX comandi biblatex, con accanto un .bib con le sole opere citate.')),
  },
  {
    id: 'library',
    target: 'home',
    title: tk('La Biblioteca'),
    lead: line(tk('La Biblioteca è la tua cartella dei documenti vista come una libreria: anteprime delle pagine, cartelle, stato di lettura di ogni documento.')),
    how: [
      line(tk('Si apre e si chiude con {lib} o con il pulsante in alto a sinistra.'), { lib: 'Ctrl+Shift+L' }),
      line(tk('Segna ogni documento come non letto, in lettura o letto, e filtra per stato.')),
      line(tk('Clic per aprire; tasto destro per rinominare, esportare, modificare un PDF o mostrarlo nella cartella.')),
    ],
    inside: line(tk('Wrambi legge la cartella che scegli senza importare né copiare nulla: i file restano tuoi, ordinati come vuoi tu. Anteprime e stati di lettura stanno nella cartella dei dati dell\'app.')),
    enter: () => showHome(),
  },
  {
    id: 'reading',
    target: 'views',
    title: tk('Leggere e annotare i PDF'),
    lead: line(tk('Un PDF si legge in tre modi che vanno di pari passo: il testo estratto, le pagine originali, oppure tutti e due affiancati, che scorrono insieme.')),
    how: [
      line(tk('Passando da una vista all\'altra resti nello stesso punto del documento.')),
      line(tk('Anche sulle pagine selezioni il testo e scegli Evidenzia o Nota: la stessa nota compare in tutte le viste.')),
      line(tk('«Modifica il PDF» cambia le pagine conservando l\'impaginazione; «Modifica il testo» ne fa una versione da riscrivere, con le pagine originali accanto.')),
    ],
    inside: line(tk('Wrambi ricostruisce il testo dalle posizioni dei caratteri del PDF. Per allineare testo e pagine confronta solo lettere e cifre, ignorando spazi, a capo e trattini: così ritrova lo stesso punto anche in un testo che hai modificato.')),
    enter: () => hideHome(),
  },
  {
    id: 'preview',
    target: 'preview',
    title: tk('Anteprima ed esportazione'),
    lead: line(tk('Accanto alla pagina vedi il documento come sarà: in HTML, in PDF impaginato, oppure come sorgente Typst o LaTeX. L\'anteprima segue il punto in cui stai scrivendo.')),
    how: [
      line(tk('{preview} apre e chiude l\'anteprima; un clic su una pagina del PDF porta il testo a quel punto.'), { preview: 'Ctrl+Shift+P' }),
      line(tk('{export} esporta in Markdown, testo, HTML, PDF, EPUB, LaTeX o Typst.'), { export: 'Ctrl+Shift+E' }),
    ],
    inside: line(tk('Il PDF lo compone Typst, un motore tipografico moderno incluso nell\'app: niente da installare e niente Internet. Ogni formato dice che cosa conserva e che cosa perde.')),
  },
  {
    id: 'calm',
    target: 'menu',
    title: tk('Concentrazione e impostazioni'),
    lead: line(tk('Quando serve, Wrambi si fa da parte: Focus lascia solo la pagina, Non disturbare tiene da parte gli avvisi.')),
    how: [
      line(tk('Dal menu: Impostazioni ({settings}) per lingua, tema, caratteri, larghezza della pagina e bibliografia.'), { settings: 'Ctrl+,' }),
      line(tk('Il vault cifrato porta note, impostazioni e documenti su un altro computer, in un solo file protetto da password.')),
    ],
    inside: line(tk('Nessun dato esce dal computer: niente account, niente statistiche, nessun controllo degli aggiornamenti. Il vault usa XChaCha20-Poly1305 con una chiave ricavata dalla password (Argon2id).')),
  },
  {
    id: 'end',
    title: tk('Tocca a te'),
    lead: line(tk('Apri un documento dalla Biblioteca o comincia a scrivere su questa pagina.')),
    how: [line(tk('{shortcuts} mostra tutte le scorciatoie.'), { shortcuts: 'Ctrl+/' }), line(tk('Questo giro resta nel menu ⋯, alla voce «Tour di Wrambi».'))],
  },
];

export function startTour() {
  ui.menu = false;
  ui.tour = 0;
}
