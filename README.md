# 📰 Aggregatore di Notizie

Un'applicazione moderna per l'aggregazione di notizie in tempo reale da fonti autorevoli italiane e internazionali. L'app raggruppa notizie simili provenienti da diverse fonti, offre potenti opzioni di ricerca e filtro, e permette di confrontare le differenze tra le versioni di una stessa notizia riportate da testate diverse.

## 📋 Indice

- [Caratteristiche principali](#caratteristiche-principali)
- [Architettura](#architettura)
- [Tecnologie utilizzate](#tecnologie-utilizzate)
- [Requisiti di sistema](#requisiti-di-sistema)
- [Installazione e setup](#installazione-e-setup)
- [Utilizzo dell'applicazione](#utilizzo-dellapplicazione)
- [Struttura del progetto](#struttura-del-progetto)
- [API](#api)
- [Configurazione avanzata](#configurazione-avanzata)
- [Troubleshooting](#troubleshooting)
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

### Frontend (React)

Il frontend si occupa di:
- Presentazione delle notizie in un'interfaccia intuitiva
- Gestione della ricerca e dei filtri
- Visualizzazione delle differenze tra articoli simili
- Caching lato client per migliorare l'esperienza offline

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
- **Winston**: Logging
- **Axios**: Client HTTP
- **TF-IDF e AI**: Algoritmi per il calcolo della similarità testuale e deduzione topic

### Frontend
- **React**: Libreria UI
- **Tailwind CSS**: Framework CSS per il design
- **Axios**: Client HTTP
- **Lucide React**: Icone
- **LocalStorage**: Caching lato client

### Infrastruttura
- **Docker**: Containerizzazione
- **Nginx**: Server web e reverse proxy
- **Docker Compose**: Orchestrazione multi-container
- **Ollama**: Servizio AI per deduzione e normalizzazione topic

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
│   │   ├── rssParser.js      # Parser RSS
│   │   ├── ollamaService.js  # Servizio di AI per topic
│   │   ├── asyncProcessor.js # Elaborazione asincrona
│   │   └── topicNormalizer.js # Normalizzazione topic (fallback)
│   └── utils/
│       └── logger.js         # Utility di logging
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
        └── components/
            ├── NewsAggregator.js # Componente principale UI
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
- `query`: Termine di ricerca

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

## ⚙️ Configurazione avanzata

### Variabili di ottimizzazione

Puoi modificare le seguenti variabili nel file `docker-compose.yml` per ottimizzare le prestazioni:

```yaml
environment:
  - OLLAMA_TIMEOUT=3000         # Timeout per le richieste Ollama (in millisecondi)
  - USE_OLLAMA=true             # Imposta a 'false' per disabilitare completamente Ollama
  - MAX_ARTICLES_PER_SOURCE=10  # Numero massimo di articoli da elaborare per fonte
```

- Riduci `MAX_ARTICLES_PER_SOURCE` su sistemi meno potenti
- Aumenta `OLLAMA_TIMEOUT` se il server Ollama è più lento
- Imposta `USE_OLLAMA=false` in caso di problemi con il server Ollama

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

## 🔧 Troubleshooting

### Problemi comuni

#### L'applicazione non si avvia

**Problema**: `docker-compose up` restituisce un errore.

**Soluzione**: Verifica che:
- Docker e Docker Compose siano installati correttamente
- La porta 80 non sia già in uso
- La rete Docker "ollama-network" esista e sia accessibile
- Tutti i file siano stati copiati nei percorsi corretti

```bash
# Verifica la porta 80
sudo lsof -i :80

# Verifica che la rete esista
docker network ls | grep ollama-network

# Se la rete non esiste, creala
docker network create ollama-network
```

#### Errori di timeout durante il caricamento delle notizie

**Problema**: La pagina restituisce errori 504 Gateway Timeout.

**Soluzione**:
- Verifica che il server Ollama sia attivo e accessibile
- Aumenta il timeout nei file di configurazione
- Riduci il numero massimo di articoli per fonte
- Disabilita temporaneamente Ollama impostando `USE_OLLAMA=false`

#### Il server Ollama non è raggiungibile

**Problema**: Log con errori di connessione a Ollama.

**Soluzione**:
- Verifica che l'URL in `OLLAMA_API_URL` sia corretto
- Verifica che il server Ollama sia in esecuzione
- Assicurati che la rete Docker consenta la comunicazione tra i container
- Controlla che il modello specificato in `OLLAMA_MODEL` sia disponibile sul server

```bash
# Verifica la connessione al server Ollama
docker exec -it news-aggregator-backend curl http://ipex-llm:11434/api/version
```

#### Nessuna notizia viene visualizzata

**Problema**: L'interfaccia si carica ma non mostra notizie.

**Soluzione**: 
- Controlla i log del backend: `docker-compose logs backend`
- Verifica che i feed RSS siano accessibili
- Controlla la connessione internet
- Verifica che i DNS funzionino correttamente (8.8.8.8 e 1.1.1.1)

#### Feed RSS non accessibili

**Problema**: Il backend non riesce ad accedere ai feed RSS.

**Soluzione**:
- Verifica la connessione internet del container
- Controlla gli URL dei feed RSS nel file `newsAggregator.js`
- Alcuni siti potrebbero bloccare le richieste da server; prova ad aggiungere uno User-Agent diverso

## 🚧 Sviluppo futuro

Ecco alcune idee per il futuro sviluppo dell'applicazione:

- **Autenticazione utente**: Consentire agli utenti di salvare le proprie preferenze
- **Notifiche**: Avvisare gli utenti quando viene pubblicata una notizia di loro interesse
- **Analisi del sentiment**: Analizzare il tono delle notizie (positivo, negativo, neutro)
- **Traduzione automatica**: Tradurre notizie da lingue diverse
- **Modalità dark**: Aggiungere un tema scuro per l'interfaccia
- **Progressive Web App**: Rendere l'applicazione installabile sui dispositivi
- **Motore di ricerca semantico**: Migliorare la ricerca con comprensione del linguaggio naturale
- **Personalizzazione avanzata**: Consentire agli utenti di personalizzare fonti e argomenti
- **Training di modelli specifici per notizie**: Creare un modello AI specializzato per l'analisi di notizie
- **Dashboard di amministrazione**: Interfaccia per monitorare e configurare l'applicazione in tempo reale