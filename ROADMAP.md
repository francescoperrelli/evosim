# EvoSim — stato del progetto e lavoro futuro

_Ultimo aggiornamento: luglio 2026._

Questo documento è il posto in cui vive la memoria lunga del progetto: dove siamo,
cosa è stato misurato, cosa resta da fare e cosa non è raggiungibile. È scritto per
essere letto fra sei mesi da qualcuno che non ricorda niente — incluso me.

Il registro sperimentale dettagliato non sta qui: sta in coda ai file che lo hanno
prodotto, come commento (`js/culture.js` per cultura e apprendimento, `js/genome.js`
per l'audit dei geni, `js/terra.js`, `js/marks.js`, `js/fire.js`). Qui c'è la sintesi.

---

## 0. Dove siamo

La simulazione è completa in un senso che non era ovvio all'inizio: le tre file di
meccaniche previste — evoluzione, civiltà, tecnologia — sono tutte a bordo, tutte
dietro un toggle, tutte accese nella build pubblicata, e tutte misurate contro un
controllo. 12 700 righe di ES module puri, nessun build step, 23 test headless su
Chromium.

Il genoma è a 38 campi serializzati. I cervelli sono reti ricorrenti con strato
nascosto di dimensione variabile (20 ingressi, 7 uscite, 2 celle di memoria, 3 canali
di segnale). Quattro pianeti separati dal vuoto, con dispersione interplanetaria
evoluta e non scriptata.

Il divario grafico e sonoro che dominava la prima versione di questo documento è in
gran parte chiuso: `js/audio.js` è passato da 85 a 463 righe (musica adattiva,
paesaggio sonoro per specie, dialetti udibili, compressore e spazializzazione),
`js/render.js` a 1388 (backdrop in cache, campo stellare, illuminazione direzionale,
particelle, animazioni di nascita e morte, campo di densità a zoom lontano).

Quello che è cambiato davvero, però, non è la lista delle feature. È quanto sappiamo
su quali di esse contano.

---

## 1. Cosa è stato fatto, e cosa ha insegnato

### 1.1 Le popolazioni sono stabili — e la causa non era quella che pensavamo tutti

Per molte sessioni l'instabilità è stata attribuita al ciclo preda-predatore o alla
scarsità di cibo. Nessuna delle due reggeva alla misura: cibo e brucatori correlano
**positivamente** a lag 0 (+0.106 / +0.147 / +0.282), e la biomassa vegetale stava
entro l'1% di `P.maxFood` quasi ovunque.

La causa era un freno artificiale: `dd = clamp(cellBodies/4, 0, 2)` che moltiplicava
il costo di riproduzione fino a 8.2×, misurato su una cella di 175 px. Leggeva
l'**aggregazione**, non l'esaurimento — cioè puniva più duramente proprio il
comportamento gregario che il genoma è selezionato a produrre. Il 25-35% dei corpi
stava fisso al massimo della penale.

Sostituito da una razione locale reale (`scarce = ddRef/(ddRef + risorsa/corpi)`),
con fertilità per pianeta campionata su un reticolo 5×4. Risultato misurato sul ramo
di produzione, semi 11/23/37, 6000 tick, statistiche sulla seconda metà:

| | popolazione media | dispersione fra semi |
|---|---|---|
| prima | 448.8 / 375.6 / 231.2 | ± 110.7 |
| dopo | 303.9 / 285.4 / 297.5 | **± 7.7** |

Il costo onesto: l'oscillazione *dentro* la singola run è peggiorata (cv da 0.140 a
0.16-0.21), perché togliendo il freno artificiale è emerso il ciclo brucatori-
vegetazione vero. Quattro smorzatori temporali (interferenza Beddington-DeAngelis,
torpore indebolito, soglia di sazietà alzata, guadagno del freno ritarato) sono stati
provati, misurati e **respinti**: tutti compravano regolarità riducendo la
popolazione. La risposta giusta è spaziale, non temporale — vedi §2.1.

### 1.2 Terra evolve davvero: le run erano solo troppo corte

Il gene di terraformazione era stato archiviato come deriva. A 40 000 tick il verdetto
si è ribaltato: è selezionato, e il segnale compare oltre i ~25 000 tick. Il motivo per
cui non si vedeva è banale e vale come lezione generale su questo progetto: **il tempo
di risposta della selezione qui è dell'ordine delle decine di migliaia di tick**, e
quasi tutte le misure precedenti giravano su 6-10 000.

### 1.3 Il baseline neutro non è quello che sembra

Un gene senza funzione **non resta** al 0.10 di fondazione. La mutazione è una
gaussiana troncata in [0,1], quindi diffonde verso 0.5: misurato 0.165 → 0.327 →
0.480 → 0.505 ± 0.115 su finestre successive di 10 000 tick, con la dispersione fra
semi che cresce da 0.016 a 0.115.

Due conseguenze operative, entrambe controintuitive:

- «il gene è salito da 0.10 a 0.4» **non è** evidenza di selezione;
- **le run lunghe non regalano potenza statistica**, perché il rumore fra semi cresce
  insieme al segnale. Ogni affermazione deve battere il proprio controllo *alla stessa
  lunghezza di run*.

### 1.4 L'apprendimento durante la vita è inerte, e va detto

Venti bracci sperimentali, tutti con reddito 0.50. Le due scuse strutturali sono state
rimosse entrambe (il frame motore era un bug vero ed è stato corretto; il bilancio
cervello/istinto è stato spazzato fino a 4× il peso istintivo) e in più è stata
implementata e provata una regola di apprendimento corretta — policy gradient con
traccia di eleggibilità, dietro `P.learnRule='rpe'` — che produce un overlay 15 volte
più grande di quello di default. Reddito invariato, e l'11% di corpi in meno.

La spiegazione residua è la stessa che l'audit del genoma dà per ogni altro gene:
**un effetto deve valere decine di punti percentuali del bilancio energetico di un
corpo prima che questo mondo possa selezionarlo**, e la differenza fra un foraggiatore
ben guidato e uno guidato mediocremente non è così grande.

Il meccanismo è reale, individuale, trasmesso fedelmente, e non cambia alcun esito.
Va descritto così e non come competenza. **Il README oggi lo descrive ancora come
adattamento con effetto Baldwin: va corretto** (vedi §2.4).

### 1.5 L'audit del genoma: tre geni su 38

Ogni campo è stato confrontato con un controllo appaiato. Solo tre risultano
misurabilmente selezionati alla lunghezza a cui l'audit è girato — quattro contando
`terra`, che a 6000 tick risultava deriva e a 40 000 no (§1.2). L'audit non è
sbagliato: è corretto per la lunghezza a cui è stato eseguito, ed è il caso più
limpido della regola 3 in §4.

Una conseguenza pratica di questo, facile da non vedere: `terra` fa parte del pool di
cinque geni «senza funzione» usato come metro di deriva in `js/genome.js` e nel
finding 14 di `js/culture.js`. Entrambi girano sotto i 10 000 tick, quindi il pool è
pulito **così come è stato eseguito** — ma quei cinque geni non sono più un metro
neutro per una run da 30 000 in su. La nota è ora scritta in entrambi i file. Tentazione naturale: potare. **Non serve**, e il motivo è
strutturale: ogni gene estrae la propria gaussiana indipendente, non esiste un budget
di mutazione condiviso che venga diluito. I geni inerti non tolgono potenza agli
altri; costano solo memoria e onestà descrittiva.

Nota emersa dall'audit: `sexual` non è un gene, è derivato dalla dieta.

### 1.6 La perdita lamarckiana

Le nascite sessuate sottraevano *metà* dell'offset appreso da *ogni* peso, invece
dell'offset intero dai loci del genitore effettivo. In media i conti tornavano, quindi
non compariva in nessun aggregato osservato. Chiusa con un meccanismo di provenienza
per-peso (`crossMask()` in `js/nn.js`), senza nuove chiamate a `rand()` e quindi senza
rompere il determinismo.

Il test che la copre è stato verificato **in entrambe le direzioni**: passa sul codice
corretto e fallisce su quello vecchio. Il primo tentativo di test aveva una tolleranza
di 0.25 che assorbiva completamente il bug — passava anche sul codice sbagliato. È il
tipo di errore che vale la pena ricordare: un test verde che non è mai stato visto
fallire non è un test.

### 1.7 I negativi onesti

- **I marchi non selezionano convenzione.** Il canale funziona in modo dimostrabile
  (errore di decodifica 0.084 contro 0.501), ma il controllo con glifi mescolati è
  statisticamente indistinguibile dal reale (0.824 ± 0.033 contro 0.846 ± 0.047).
  Anche l'ultima ipotesi in piedi — rischio asimmetrico, cioè scambiare un pericolo
  per foraggio deve essere letale — è stata implementata e misurata, e non cambia
  nulla. Spedito comunque per ragioni di design, con l'avvertenza scritta nel file.
- **L'assortimento non funziona** con nessuna chiave di parentela disponibile qui.
- **La cultura trasmette contenuto e non compra niente.** L'indice discrimina il
  contenuto reale dal rumore di pari banda di un fattore 1.7, e il reddito è identico
  nei quattro bracci (0.50 ovunque). Un canale che funziona e trasporta qualcosa che
  nessuno può mangiare.

---

## 2. Cosa resta

### 2.1 ~~Struttura spaziale per l'oscillazione~~ — PROVATA E RESPINTA

Era la voce a priorità 1. È stata costruita, misurata e rimossa. Il resoconto completo
sta in `js/world.js`, sotto `FOOD_SEED`/`FOOD_LOG`; qui il minimo indispensabile.

**La premessa era già falsa.** L'idea si regge sull'ipotesi che le chiazze si muovano
oggi in sincrono, così che disaccoppiarle guadagni qualcosa. Non è così. Correlazione
media fra le serie temporali delle chiazze nel mondo di serie: **0.16–0.23**. La
varianza del raccolto *fra* chiazze allo stesso istante sta a **528–962** contro
**18–85** della varianza della media planetaria nel tempo. In questo mondo c'è già
venti-trenta volte più variazione spaziale che temporale: non restava sincronia da
rompere.

**Imporla peggiora il caso duro.** Logistica per chiazza più dispersione limitata,
contro il proprio controllo: braccio di serie fermo (cv 0.188 → 0.186), braccio
solo-ecologia peggiore in tutti e tre i semi (cv 0.604 → 0.723, popolazione media
133 → 115). Il motivo è nella stessa sonda: la crescita dallo stand è crescita dove
sta lo stand, e dove sta lo stand stanno già gli erbivori. Quella che dal lato della
pianta si chiama «limitazione della dispersione», dal lato dell'animale si chiama
consegna a domicilio.

**Anche l'obiettivo era un artefatto.** Il criterio «cv sotto 0.14» era stato fissato
perché il mondo di serie misurava 0.154 — su **tre** semi. Su sei (11/23/37/53/71/97)
misura **0.175 con sd fra semi di 0.049**. L'obiettivo stava dentro una sd da dove il
mondo già era. La regola 3 del §4 dice che le run corte mentono; questa ne è la
sorella: **pochi semi mentono**, e mentono nella direzione lusinghiera, perché chi
sceglie quanti semi fare si ferma quando il numero somiglia a un risultato.

**E la stabilità non è attribuibile.** Il seguito ovvio era trovare quale meccanica
compra il disaccoppiamento, visto che il braccio solo-ecologia sta a 0.593 contro
0.175. Su tre semi sembravano i nidi (+0.095 di cv togliendoli). Su sei sono
+0.027 con sd 0.098 e segno sbagliato in due semi: niente. Idem territorio, villaggi,
stormi, proprietà — tutte nella stessa direzione, nessuna separabile dal rumore. Si
muove solo togliendo in blocco tutto il livello 2 e 3. La fedeltà al sito che tiene
indipendenti le chiazze è diffusa fra due dozzine di meccaniche e non è nessuna di
esse.

Quel che resta dell'oscillazione **non è spaziale**. Il file non deve crescere un'altra
meccanica puntata lì finché qualcuno non sa dire che cosa *sia*.

### 2.2 `P.mut` da 0.08 a 0.04 — decisione aperta

Il rapporto segnale/rumore fra i semi ha un massimo a 0.04 (9.8 contro 7.5 a 0.08).
Ma l'effetto misurato cresce con il tasso: è il rumore a degradare più in fretta del
segnale, quindi il guadagno è modesto e si paga in quanto rapidamente un giocatore
*vede* cambiare i lignaggi. È un compromesso di game feel, non di correttezza.
**In attesa di decisione.**

### 2.3 Grafica e suono: quello che manca davvero

Quasi tutto il §1 e §2 della vecchia roadmap è a bordo. Restano:

- **Cartolina e time-lapse** (§1.10 originale): esportazione di uno screenshot con
  seed, tick e statistiche in sovraimpressione, e una GIF time-lapse. È il modo in cui
  un progetto così si diffonde, ed è l'unica voce grafica ancora completamente
  scoperta.
- **Grafici interrogabili**: griglia e assi ci sono, mancano tooltip con i valori,
  pausa e zoom sulla finestra temporale.

### 2.4 Allineare la documentazione a ciò che è stato misurato

Il README descrive l'apprendimento durante la vita come adattamento con effetto
Baldwin. Dopo §1.4 non è più una descrizione difendibile. Stessa verifica va fatta su
cultura, marchi e assortimento: la regola è che l'interfaccia e la cronaca non devono
raccontare al giocatore qualcosa che non sta accadendo.

### 2.5 Ipotesi ancora non provate

- **Duplicazione genica** per la crescita cerebrale: `evolvOn` esiste, ma il ramo di
  duplicazione non è mai stato misurato contro il proprio controllo.
- **Albero filogenetico navigabile**: `js/phylo.js` traccia i lignaggi, l'albero come
  oggetto di interfaccia esplorabile no.
- **Ricontatto dopo divergenza allopatrica**: i pianeti divergono, ma cosa succede
  quando due lignaggi separati si reincontrano non è mai stato guardato in modo
  sistematico.

---

## 3. Cosa resta fuori portata

Va ripetuto perché è facile lasciarsi trascinare, e più il progetto cresce più diventa
facile. Questa architettura **non** produrrà:

- linguaggio aperto e composizionale (i canali di segnale sono tre e continui);
- invenzione tecnologica genuinamente aperta — le «tecnologie» restano un insieme
  finito scritto da noi, per quanto l'ordine di acquisizione sia emergente;
- alcuna forma di coscienza.

Ciò che produce davvero, e che è misurato: cambiamento nei tratti ereditabili guidato
dalla selezione, corse agli armamenti, coevoluzione gene-cultura, convenzioni
emergenti quando la selezione arriva a vederle. È molto. La differenza va tenuta
esplicita nell'interfaccia, nella cronaca e nel README.

C'è poi un limite quantitativo che vale come regola di progetto, e che è la
generalizzazione di §1.4: **un meccanismo che non muove decine di punti percentuali
del bilancio energetico di un corpo non sarà selezionato in questo mondo.** Prima di
implementare qualcosa di nuovo, conviene stimare quanto vale in energia. Se la risposta
è «qualche percento», sarà bello da guardare e invisibile alla selezione — legittimo,
ma va saputo prima e non dopo.

---

## 4. Metodo

Quattro regole guadagnate a caro prezzo, tutte con almeno un errore alle spalle.

1. **Ogni affermazione batte il proprio controllo alla stessa lunghezza di run.** Un
   gene che sale non è un gene selezionato (§1.3).
2. **Un test che non è mai stato visto fallire non è un test.** Rompere di proposito il
   codice e verificare che il test se ne accorga (§1.6).
3. **Le run corte mentono.** La selezione qui risponde su decine di migliaia di tick
   (§1.2).
4. **I negativi si spediscono insieme al codice.** Quando una meccanica viene tenuta
   per ragioni di design nonostante non selezioni nulla, l'avvertenza va scritta nel
   file, non nel messaggio di commit (§1.7).

Gli agenti che lavorano in parallelo usano worktree git con proprietà dei file
strettamente disgiunta, verificano il proprio commit di base, e non usano mai
`git stash` (`refs/stash` è condiviso fra i worktree).
