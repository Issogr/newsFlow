# 📰 Aggregatore di Notizie

Un'applicazione moderna per l'aggregazione di notizie in tempo reale da fonti autorevoli italiane e internazionali. L'app raggruppa notizie simili provenienti da diverse fonti, offre potenti opzioni di ricerca e filtro, e permette di confrontare le differenze tra le versioni di una stessa notizia riportate da testate diverse.

## 📋 Indice

- [Caratteristiche principali](#caratteristiche-principali)
- [Miglioramenti recenti](#miglioramenti-recenti)
- [Architettura](#architettura)
- [Tecnologie utilizzate](#tecnologie-utilizzate)
- [Requisiti di sistema](#requisiti-di-sistema)
- [Installazione e setup](#installazione-e-setup)
- [Utilizzo dell'applicazione](#utilizzo-dellapplicazione)
- [Struttura del progetto](#struttura-del-progetto)
- [API](#api)
- [Configurazione avanzata](#configurazione-avanzata)
- [Sviluppo futuro](#sviluppo-futuro)

## ✨ Caratteristiche principali

- **Aggregazione multi-fonte**: Raccoglie notizie da numerose fonti autorevoli italiane e internazionali attraverso feed RSS
- **Raggruppamento intelligente**: Utilizza algoritmi TF-IDF e AI per identificare e raggruppare notizie simili provenienti da fonti diverse
- **Deduzione intelligente di topic**: Utilizza AI per dedurre automaticamente i topic di articoli che ne sono privi
- **Normalizzazione multilingua**: Riconosce e normalizza topic in diverse lingue in un formato standardizzato
- **Ricerca avanzata**: Cerca in tutto il database di notizie, non solo tra quelle visualizzate
- **Filtri flessibili**: Filtra per fonte, argomento o utilizzando i topic caldi del momento
- **Funzione diff**: Confronta visivamente le differenze nel modo in cui diverse testate riportano la stessa notizia
- **Sistema di cache avanzato**:
  - Cache lato server multi-livello per ottimizzare le richieste RSS e AI
  - Elaborazione asincrona in background per evitare timeout
  - Cache lato client per migliorare le prestazioni anche offline
- **Design responsive**: Interfaccia utente moderna che si adatta a qualsiasi dispositivo
- **Aggiornamenti in tempo reale**: Dati sempre aggiornati dalle fonti originali
- **Accessibilità migliorata**: Interfaccia completamente accessibile con supporto per screen reader e navigazione da tastiera
- **Gestione errori avanzata**: Sistema standardizzato per gestire e visualizzare gli errori
- **Sicurezza potenziata**: Sanitizzazione HTML e validazione input

## 🚀 Miglioramenti recenti

Le seguenti migliorie sono state implementate per aumentare la robustezza, l'accessibilità e le prestazioni dell'applicazione:

1. **Standardizzazione della gestione degli errori**:
   - Sistema centralizzato per formattazione e gestione errori
   - Middleware per cattura automatica delle eccezioni
   - Messaggi di errore più informativi e user-friendly

2. **Sistema di retry per i feed RSS**:
   - Implementazione di backoff esponenziale con jitter
   - Riprova automatica in caso di fallimento della connessione
   - Logging dettagliato degli errori di connessione

3. **Parsing HTML più sicuro**:
   - Implementazione di DOMPurify per la sanitizzazione dell'HTML
   - Prevenzione di potenziali vulnerabilità XSS

4. **Validazione dati migliorata**:
   - Validazione dei parametri delle richieste con express-validator
   - Sanitizzazione degli input per prevenire injection

5. **Gestione asincrona migliorata**:
   - Hook `useAsync` personalizzato per la gestione dello stato asincrono
   - Gestione più efficiente dei caricamenti e degli errori

6. **Ottimizzazione delle prestazioni React**:
   - Implementazione di React.memo per prevenire re-render non necessari
   - Uso di useMemo e useCallback per ottimizzare il calcolo di valori derivati

7. **Accessibilità migliorata**:
   - Aggiunta di attributi ARIA per supportare tecnologie assistive
   - Miglioramento della navigazione da tastiera
   - Contrasto dei colori adeguato alle linee guida WCAG

8. **Container Docker ottimizzati**:
   - Multi-stage build per ridurre le dimensioni delle immagini
   - Configurazione di sicurezza migliorata
   - Dockerfile più efficienti

9. **Health check dei container**:
   - Endpoint di health check per monitorare lo stato dell'applicazione
   - Integrabile con sistemi di orchestrazione container

10. **Logging avanzato**:
    - Configurazione Winston migliorata per la rotazione dei log
    - Gestione separata degli errori, eccezioni e promise rifiutate
    - Formattazione JSON per una migliore integrazione con strumenti di analisi

## 🏗 Architettura

L'applicazione è divisa in componenti orchestrati tramite Docker e si connette a un servizio Ollama esistente:

### Backend (Node.js/Express)

Il backend gestisce:
- Recupero dati dai feed RSS
- Analisi e normalizzazione del contenuto
- Raggruppamento di notizie simili
- Elaborazione asincrona in background per deduzione topic
- Caching multi-livello per ottimizzare le prestazioni
- API RESTful per il frontend
- Gestione standardizzata degli errori
- Validazione e sanitizzazione degli input

### Frontend (React)

Il frontend si occupa di:
- Presentazione delle notizie in un'interfaccia intuitiva
- Gestione della ricerca e dei filtri
- Visualizzazione delle differenze tra articoli simili
- Caching lato client per migliorare l'esperienza offline
- Gestione avanzata dello stato asincrono
- Interfaccia accessibile e responsive

### Servizio Ollama Esterno

L'applicazione si connette a un servizio Ollama esterno che:
- Deduce topic per articoli che ne sono privi
- Normalizza topic in diverse lingue
- Fornisce capacità di IA con minimo impatto sulle prestazioni

## 🛠 Tecnologie utilizzate

### Backend
- **Node.js**: Runtime JavaScript
- **Express**: Framework web
- **RSS Parser**: Parsing dei feed RSS
- **Memory Cache**: Caching lato server
- **Winston**: Logging avanzato
- **Axios**: Client HTTP con sistema di retry
- **TF-IDF e AI**: Algoritmi per il calcolo della similarità testuale e deduzione topic
- **DOMPurify**: Sanitizzazione HTML
- **jsdom**: Ambiente DOM lato server
- **Express Validator**: Validazione e sanitizzazione delle richieste

### Frontend
- **React**: Libreria UI con hooks personalizzati
- **Tailwind CSS**: Framework CSS per il design
- **Axios**: Client HTTP
- **Lucide React**: Icone
- **LocalStorage**: Caching lato client
- **React Memo**: Ottimizzazione delle prestazioni

### Infrastruttura
- **Docker**: Containerizzazione con multi-stage build
- **Nginx**: Server web e reverse proxy
- **Docker Compose**: Orchestrazione multi-container
- **Ollama**: Servizio AI per deduzione e normalizzazione topic
- **Health Checks**: Monitoraggio dello stato dei container

## 💻 Requisiti di sistema

- **Docker**: versione 20.10.0 o superiore
- **Docker Compose**: versione 1.29.0 o superiore
- **Porta 80**: disponibile sul sistema host
- **Accesso a un server Ollama**: con rete Docker condivisa o accessibile via HTTP

## 🚀 Installazione e setup

### 1. Clona il repository

```bash
git clone https://github.com/tuousername/news-aggregator.git
cd news-aggregator
```

### 2. Configurazione

#### Configurazione per server Ollama esistente

Il file `docker-compose.yml` è configurato per connettersi a un server Ollama esistente sulla rete Docker "ollama-network". Verifica che:

1. Il tuo server Ollama sia raggiungibile all'indirizzo specificato in `OLLAMA_API_URL`
2. Il modello specificato in `OLLAMA_MODEL` sia disponibile sul server Ollama
3. La rete Docker "ollama-network" esista e sia accessibile

Se necessario, modifica queste variabili nel `docker-compose.yml`:

```yaml
environment:
  - OLLAMA_API_URL=http://ipex-llm:11434/api  # Modifica con l'URL del tuo server Ollama
  - OLLAMA_MODEL=gemma3:1b                   # Modifica con il modello disponibile
  - OLLAMA_TIMEOUT=3000                      # Timeout per chiamate a Ollama in ms
  - USE_OLLAMA=true                          # Imposta a 'false' per disabilitare Ollama
  - MAX_ARTICLES_PER_SOURCE=10               # Numero massimo di articoli da elaborare per fonte
  - RSS_MAX_RETRIES=3                        # Numero massimo di tentativi per le richieste RSS
  - RSS_RETRY_DELAY=1000                     # Ritardo iniziale tra i tentativi in ms
```

### 3. Avvio dell'applicazione

```bash
# Avvia l'applicazione con Docker Compose
docker-compose up --build -d
```

L'applicazione sarà disponibile all'indirizzo: http://localhost

### 4. Arresto dell'applicazione

```bash
docker-compose down
```

## 📱 Utilizzo dell'applicazione

### Interfaccia principale

L'applicazione presenta un'interfaccia intuitiva con le seguenti sezioni:

- **Header**: Titolo dell'applicazione e pulsante di aggiornamento
- **Barra di ricerca**: Cerca notizie in tutto il database
- **Filtri**: Selezione per fonte e argomento
- **Filtri rapidi**: Topic caldi e opzione "più recenti"
- **Feed principale**: Elenco delle notizie raggruppate
- **Footer**: Informazioni sull'applicazione e statistiche

### Ricerca di notizie

1. Digita un termine nella barra di ricerca
2. L'applicazione cercherà in tutto il database, non solo nelle notizie visualizzate
3. I risultati appariranno durante la digitazione

### Filtri

Puoi filtrare le notizie in diversi modi:

- **Per fonte**: Seleziona una testata dal menù a tendina "Fonti"
- **Per argomento**: Seleziona un topic dal menù a tendina "Argomenti"
- **Topic caldi**: Clicca su uno dei topic nella barra dei filtri rapidi
- **Più recenti**: Ordina le notizie dalla più recente

I filtri possono essere combinati tra loro.

### Visualizzazione delle differenze

Per notizie presenti su più fonti:

1. Clicca sul pulsante "Mostra diff" nella card della notizia
2. Apparirà un riquadro con il confronto tra le versioni
3. Le differenze sono evidenziate con codice colore:
   - **Rosso**: testo presente solo nella prima fonte
   - **Verde**: testo presente solo nella seconda fonte
   - **Nero**: testo presente in entrambe le fonti

## 📁 Struttura del progetto

```
news-aggregator/
├── docker-compose.yml       # Configurazione Docker Compose
├── backend/
│   ├── Dockerfile           # Configurazione container backend
│   ├── package.json         # Dipendenze Node.js
│   ├── server.js            # Punto di ingresso del server
│   ├── routes/
│   │   └── api.js           # Route API
│   ├── services/
│   │   ├── newsAggregator.js # Logica di aggregazione
│   │   ├── rssParser.js      # Parser RSS con retry
│   │   ├── ollamaService.js  # Servizio di AI per topic
│   │   ├── asyncProcessor.js # Elaborazione asincrona
│   │   └── topicNormalizer.js # Normalizzazione topic (fallback)
│   └── utils/
│       ├── logger.js         # Utility di logging avanzato
│       └── errorHandler.js   # Gestione centralizzata degli errori
└── frontend/
    ├── Dockerfile           # Configurazione container frontend
    ├── nginx.conf           # Configurazione Nginx
    ├── package.json         # Dipendenze React
    ├── tailwind.config.js   # Configurazione Tailwind CSS
    └── src/
        ├── App.js           # Componente principale React
        ├── index.js         # Punto di ingresso React
        ├── services/
        │   └── api.js       # Client API
        ├── hooks/
        │   └── useAsync.js  # Hook per gestione stato asincrono
        └── components/
            ├── NewsAggregator.js # Componente principale UI
            ├── NewsCard.js       # Componente per la visualizzazione di una notizia
            └── ErrorMessage.js   # Componente per gestione errori
```

## 🔌 API

Il backend espone le seguenti API RESTful:

### `GET /api/news`

Recupera tutte le notizie raggruppate.

**Response**:
```json
[
  {
    "id": "group-1",
    "items": [...],
    "sources": ["Corriere della Sera", "La Repubblica"],
    "title": "Titolo della notizia",
    "description": "Descrizione della notizia",
    "pubDate": "2025-03-15T09:45:00Z",
    "topics": ["Economia", "Politica"],
    "url": "https://www.esempio.it/notizia"
  },
  ...
]
```

### `GET /api/news/search?query=<termine>`

Cerca notizie in base al termine specificato.

**Parametri**:
- `query`: Termine di ricerca (validato e sanitizzato)

**Response**: Formato identico a `/api/news`, filtrato in base alla query.

### `GET /api/hot-topics`

Recupera i topic più popolari.

**Response**:
```json
[
  {
    "topic": "Economia",
    "count": 15
  },
  {
    "topic": "Tecnologia",
    "count": 12
  },
  ...
]
```

### `GET /api/sources`

Recupera l'elenco delle fonti disponibili.

**Response**:
```json
[
  {
    "id": "corriere",
    "name": "Corriere della Sera",
    "language": "it"
  },
  ...
]
```

### `GET /api/topics/map`

Recupera la mappatura dei topic in diverse lingue.

**Response**:
```json
{
  "topics": ["Politica", "Economia", "Tecnologia", ...],
  "mappings": {
    "Politica": ["politics", "politique", ...],
    "Economia": ["economy", "économie", ...],
    ...
  }
}
```

### `GET /api/health`

Verifica lo stato di salute dell'applicazione.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-03-16T12:34:56.789Z",
  "uptime": 3600,
  "cacheStatus": "ok"
}
```

## ⚙️ Configurazione avanzata

### Variabili di ottimizzazione

Puoi modificare le seguenti variabili nel file `docker-compose.yml` per ottimizzare le prestazioni:

```yaml
environment:
  - OLLAMA_TIMEOUT=3000         # Timeout per le richieste Ollama (in millisecondi)
  - USE_OLLAMA=true             # Imposta a 'false' per disabilitare completamente Ollama
  - MAX_ARTICLES_PER_SOURCE=10  # Numero massimo di articoli da elaborare per fonte
  - RSS_MAX_RETRIES=3           # Numero massimo di tentativi per le richieste RSS
  - RSS_RETRY_DELAY=1000        # Ritardo iniziale tra i tentativi in ms
  - SERVER_TIMEOUT=60000        # Timeout del server in ms
  - LOG_LEVEL=info              # Livello di logging (debug, info, warn, error)
```

- Riduci `MAX_ARTICLES_PER_SOURCE` su sistemi meno potenti
- Aumenta `OLLAMA_TIMEOUT` se il server Ollama è più lento
- Imposta `USE_OLLAMA=false` in caso di problemi con il server Ollama
- Regola `RSS_MAX_RETRIES` e `RSS_RETRY_DELAY` in base alla stabilità della connessione

### Aggiungere nuove fonti di notizie

Puoi aggiungere nuove fonti modificando l'array `newsSources` nel file `backend/services/newsAggregator.js`:

```javascript
const newsSources = [
  {
    id: "nuova-fonte",
    name: "Nome della Fonte",
    url: "https://www.nuovafonte.it/rss.xml",
    type: "rss",
    language: "it"
  },
  // altre fonti...
];
```

### Modificare i parametri di caching

Per modificare la durata della cache lato server, modifica i valori nel file `backend/routes/api.js`:

```javascript
router.get('/news', cacheMiddleware(300), async (req, res, next) => {
  // 300 secondi (5 minuti)
});
```

Per la cache lato client, modifica la costante `CACHE_EXPIRY` nel componente React:

```javascript
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minuti in millisecondi
```

### Personalizzare l'algoritmo di similarità

Puoi modificare la soglia di similarità nel file `backend/services/newsAggregator.js`:

```javascript
// Aumenta questo valore per richiedere maggiore similarità tra gli articoli
if (similarity > 0.3) { // Soglia di similarità
  // ...
}
```

### Configurare il logging

Modifica il livello di logging nel file `docker-compose.yml`:

```yaml
environment:
  - LOG_LEVEL=debug  # Opzioni: error, warn, info, debug
```

Per una configurazione più dettagliata, modifica il file `backend/utils/logger.js`.

## 🚧 Sviluppo futuro

Ecco alcune idee per il futuro sviluppo dell'applicazione:
- **Analisi del sentiment**: Analizzare il tono delle notizie (positivo, negativo, neutro)
- **Traduzione automatica**: Tradurre notizie da lingue diverse
- **Modalità dark**: Aggiungere un tema scuro per l'interfaccia
