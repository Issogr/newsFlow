# 📰 Aggregatore di Notizie con Aggiornamenti in Tempo Reale

Un'applicazione moderna per l'aggregazione di notizie in tempo reale da fonti autorevoli italiane e internazionali. L'app raggruppa notizie simili provenienti da diverse fonti, offre potenti opzioni di ricerca e filtro, e riceve automaticamente aggiornamenti via WebSocket.

## 📋 Indice

- [Caratteristiche principali](#caratteristiche-principali)
- [Nuove funzionalità](#nuove-funzionalità)
- [Architettura](#architettura)
- [Tecnologie utilizzate](#tecnologie-utilizzate)
- [Requisiti di sistema](#requisiti-di-sistema)
- [Installazione e setup](#installazione-e-setup)
- [Utilizzo dell'applicazione](#utilizzo-dellapplicazione)
- [API](#api)
- [WebSockets](#websockets)
- [Configurazione avanzata](#configurazione-avanzata)
- [Sviluppo futuro](#sviluppo-futuro)
- [Risoluzione problemi](#risoluzione-problemi)

## ✨ Caratteristiche principali

- **Aggregazione multi-fonte**: Raccoglie notizie da numerose fonti autorevoli italiane e internazionali attraverso feed RSS
- **Raggruppamento intelligente**: Utilizza algoritmi TF-IDF e AI per identificare e raggruppare notizie simili provenienti da fonti diverse
- **Deduzione intelligente di topic**: Utilizza AI per dedurre automaticamente i topic di articoli che ne sono privi
- **Normalizzazione multilingua**: Riconosce e normalizza topic in diverse lingue in un formato standardizzato
- **Ricerca avanzata**: Cerca in tutto il database di notizie, non solo tra quelle visualizzate
- **Filtri flessibili**: Filtra per fonte, argomento o utilizzando i topic caldi del momento
- **Elaborazione asincrona**: Elaborazione in background per evitare timeout durante le richieste complesse
- **Design responsive**: Interfaccia utente moderna che si adatta a qualsiasi dispositivo
- **Aggiornamenti in tempo reale**: Ricezione automatica di nuovi articoli e aggiornamenti tramite WebSockets
- **Accessibilità migliorata**: Interfaccia completamente accessibile con supporto per screen reader e navigazione da tastiera
- **Gestione errori avanzata**: Sistema standardizzato per gestire e visualizzare gli errori
- **Sicurezza potenziata**: Sanitizzazione HTML e validazione input

## 🚀 Nuove funzionalità

### Aggiornamenti in Tempo Reale

L'applicazione ora include un sistema di aggiornamenti in tempo reale tramite WebSockets, offrendo una serie di vantaggi:

1. **Ricezione automatica di nuovi articoli**:
   - Notifica dell'arrivo di nuovi articoli senza necessità di refresh manuale della pagina
   - Badge che mostra il numero di nuovi articoli disponibili

2. **Notifiche in tempo reale**:
   - Sistema di notifiche Toast per informare l'utente di eventi importanti
   - Notifiche per nuovi articoli, aggiornamenti dei topic e messaggi di sistema

3. **Filtri interattivi con WebSocket**:
   - I filtri attivi vengono sincronizzati con il server per ricevere aggiornamenti pertinenti
   - Ottimizzazione del traffico di rete ricevendo solo aggiornamenti rilevanti

4. **Stato della connessione visibile**:
   - Indicatore dello stato della connessione WebSocket
   - Tentativi automatici di riconnessione in caso di disconnessione

5. **Riduzione del carico del server**:
   - Gli aggiornamenti vengono inviati solo quando necessario, riducendo le richieste HTTP
   - Aggiornamenti incrementali invece di recupero completo dei dati

## 🏗 Architettura

L'applicazione è divisa in componenti orchestrati tramite Docker e si connette a un servizio Ollama esistente:

### Backend (Node.js/Express)

Il backend gestisce:
- Recupero dati dai feed RSS
- Analisi e normalizzazione del contenuto
- Raggruppamento di notizie simili
- Elaborazione asincrona in background per deduzione topic
- API RESTful per il frontend
- Server WebSocket per aggiornamenti in tempo reale
- Gestione standardizzata degli errori
- Validazione e sanitizzazione degli input

### Frontend (React)

Il frontend si occupa di:
- Presentazione delle notizie in un'interfaccia intuitiva
- Gestione della ricerca e dei filtri
- Gestione della connessione WebSocket con hook personalizzati
- Visualizzazione di notifiche in tempo reale
- Sistema di gestione stato per aggiornamenti ottimizzati
- Interfaccia accessibile e responsive

### WebSocket (Socket.IO)

Il sistema WebSocket gestisce:
- Connessioni persistenti tra client e server
- Sistema di stanze per filtrare gli aggiornamenti rilevanti
- Notifiche push per nuovi articoli e aggiornamenti di topic
- Recupero efficiente degli aggiornamenti con payload minimizzati
- Riconnessione automatica in caso di disconnessione

### Servizio Ollama Esterno

L'applicazione si connette a un servizio Ollama esterno che:
- Deduce topic per articoli che ne sono privi
- Normalizza topic in diverse lingue
- Fornisce capacità di IA con minimo impatto sulle prestazioni

## 🛠 Tecnologie utilizzate

### Backend
- **Node.js**: Runtime JavaScript
- **Express**: Framework web
- **Socket.IO**: Server WebSocket per comunicazione real-time
- **RSS Parser**: Parsing dei feed RSS
- **Winston**: Logging avanzato
- **Axios**: Client HTTP con sistema di retry
- **TF-IDF e AI**: Algoritmi per il calcolo della similarità testuale e deduzione topic
- **Express Validator**: Validazione e sanitizzazione delle richieste

### Frontend
- **React**: Libreria UI con hooks personalizzati
- **Socket.IO Client**: Client WebSocket per connessione real-time
- **Tailwind CSS**: Framework CSS per il design
- **Axios**: Client HTTP
- **Lucide React**: Icone
- **React Memo**: Ottimizzazione delle prestazioni

### Infrastruttura
- **Docker**: Containerizzazione con multi-stage build
- **Nginx**: Server web, reverse proxy e proxy WebSocket
- **Docker Compose**: Orchestrazione multi-container
- **Ollama**: Servizio AI per deduzione e normalizzazione topic
- **Health Checks**: Monitoraggio dello stato dei container

## 💻 Requisiti di sistema

- **Docker**: versione 20.10.0 o superiore
- **Docker Compose**: versione 1.29.0 o superiore
- **Porta 80**: disponibile sul sistema host
- **Accesso a un server Ollama**: con rete Docker condivisa o accessibile via HTTP
- **Permessi**: è necessario creare directory con permessi appropriati prima dell'avvio (vedi sezione installazione)

## 🚀 Installazione e setup

### 1. Clona il repository

```bash
git clone https://github.com/tuousername/news-aggregator.git
cd news-aggregator
```

### 2. Preparazione delle directory (IMPORTANTE)

Prima di avviare l'applicazione, è necessario creare le directory per i log e i dati con i permessi appropriati:

```bash
# Crea le directory se non esistono
mkdir -p ./backend/logs ./backend/data

# Opzionale: allinea ownership/permessi (utile in caso di errori EACCES)
sudo chown -R 1001:1001 ./backend/logs ./backend/data
sudo chmod -R 775 ./backend/logs ./backend/data
```

> ℹ️ `docker-compose.yml` include un servizio `init-permissions` che prova automaticamente a correggere i permessi prima di avviare il backend.

### 3. Configurazione

#### Configurazione per server Ollama esistente (opzionale)

La configurazione base (`docker-compose.yml`) funziona anche senza Ollama locale.
Se vuoi connetterti a un server Ollama sulla rete Docker `ollama-network`, verifica che:

1. Il tuo server Ollama sia raggiungibile all'indirizzo specificato in `OLLAMA_API_URL`
2. Il modello specificato in `OLLAMA_MODEL` sia disponibile sul server Ollama
3. La rete Docker `ollama-network` esista e sia accessibile

Se necessario, modifica queste variabili nel `docker-compose.yml`:

```yaml
environment:
  - OLLAMA_API_URL=http://ipex-llm:11434/api  # Modifica con l'URL del tuo server Ollama
  - OLLAMA_MODEL=gemma3:1b                   # Modifica con il modello disponibile
  - ALLOWED_ORIGINS=http://localhost,http://localhost:80 # Origini consentite per CORS/WebSocket
  - TRUST_PROXY=true                         # Abilita IP client reali dietro reverse proxy
  - ADMIN_API_TOKEN=change-me                # Token richiesto per endpoint amministrativi
  - OLLAMA_TIMEOUT=3000                      # Timeout per chiamate a Ollama in ms
  - USE_OLLAMA=true                          # Imposta a 'false' per disabilitare Ollama
  - MAX_ARTICLES_PER_SOURCE=10               # Numero massimo di articoli per fonte
  - MIN_UPDATE_INTERVAL=60000                # Intervallo minimo tra aggiornamenti (ms)
  - WS_PING_TIMEOUT=60000                    # Timeout per ping WebSocket (ms)
  - WS_PING_INTERVAL=25000                   # Intervallo tra ping WebSocket (ms)
```

### 4. Avvio dell'applicazione

```bash
# Avvio base (senza rete Ollama esterna)
docker-compose up --build -d

# Avvio con Ollama locale su rete esterna opzionale
docker-compose -f docker-compose.yml -f docker-compose.ollama.yml up --build -d
```

L'applicazione sarà disponibile all'indirizzo: http://localhost

### 5. Arresto dell'applicazione

```bash
docker-compose down
```

## 📱 Utilizzo dell'applicazione

### Interfaccia principale

L'applicazione presenta un'interfaccia intuitiva con le seguenti sezioni:

- **Header**: Titolo dell'applicazione, indicatore WebSocket e pulsante di aggiornamento
- **Barra di ricerca**: Cerca notizie in tutto il database
- **Filtri**: Selezione per fonte e argomento
- **Filtri rapidi**: Topic caldi e opzione "più recenti"
- **Feed principale**: Elenco delle notizie raggruppate
- **Centro notifiche**: Notifiche in tempo reale e badge per nuovi articoli
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

I filtri possono essere combinati tra loro e influenzano anche gli aggiornamenti in tempo reale che riceverai.

### Aggiornamenti in tempo reale

L'applicazione riceve automaticamente aggiornamenti tramite WebSocket:

1. **Indicatore di connessione**: Un'icona nella barra superiore mostra lo stato della connessione WebSocket
2. **Badge nuovi articoli**: Quando sono disponibili nuovi articoli, un badge apparirà nell'angolo in alto a destra
3. **Notifiche toast**: Le notifiche vengono mostrate in alto a destra per segnalare eventi importanti
4. **Aggiornamento automatico dei topic**: I topic degli articoli vengono aggiornati automaticamente quando il server AI deduce nuovi argomenti

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

### `POST /api/refresh`

Forza un aggiornamento immediato delle notizie.

**Autenticazione richiesta**:
- Header `Authorization: Bearer <ADMIN_API_TOKEN>` oppure
- Header `X-Admin-Token: <ADMIN_API_TOKEN>`

**Response**:
```json
{
  "success": true,
  "message": "Dati aggiornati con successo",
  "count": 42
}
```

### `POST /api/ws/notify?message=...&type=info`

Invia una notifica di sistema a tutti i client connessi.

**Autenticazione richiesta**:
- Header `Authorization: Bearer <ADMIN_API_TOKEN>` oppure
- Header `X-Admin-Token: <ADMIN_API_TOKEN>`

### `GET /api/ws/status`

Recupera lo stato attuale delle connessioni WebSocket.

**Response**:
```json
{
  "activeConnectionsCount": 5,
  "totalConnections": 10,
  "newsUpdatesSent": 42,
  "topicUpdatesSent": 15,
  "timestamp": "2025-03-16T12:34:56.789Z"
}
```

## 📡 WebSockets

L'applicazione utilizza Socket.IO per la comunicazione in tempo reale. Ecco i principali eventi:

### Eventi dal server al client

| Evento | Descrizione | Payload |
|--------|-------------|---------|
| `welcome` | Inviato al client quando si connette | `{ message: string, timestamp: string }` |
| `news:update` | Nuovi articoli disponibili | `{ count: number, data: array, timestamp: string }` |
| `topic:update` | Aggiornamento topic per un articolo | `{ articleId: string, topics: array, timestamp: string }` |
| `system:notification` | Notifica di sistema | `{ notificationType: string, message: string, timestamp: string }` |
| `pong` | Risposta a un ping del client | `{ timestamp: number }` |

### Eventi dal client al server

| Evento | Descrizione | Payload |
|--------|-------------|---------|
| `subscribe:filters` | Aggiorna i filtri di sottoscrizione | `{ topics: array, sources: array }` |
| `ping` | Mantiene attiva la connessione | `{}` |

### Stanze WebSocket

Il server organizza i client in "stanze" per inviare aggiornamenti mirati:

- `all-updates`: Tutti i client connessi
- `topic:<nome-topic>`: Client interessati a un topic specifico
- `source:<nome-fonte>`: Client interessati a una fonte specifica

## ⚙️ Configurazione avanzata

### Variabili di ottimizzazione WebSocket

Puoi modificare le seguenti variabili nel file `docker-compose.yml` per ottimizzare le performance WebSocket:

```yaml
environment:
  - WS_PING_TIMEOUT=60000       # Timeout per ping WebSocket (ms)
  - WS_PING_INTERVAL=25000      # Intervallo tra ping WebSocket (ms)
  - MIN_UPDATE_INTERVAL=60000   # Intervallo minimo tra aggiornamenti (ms)
  - ALLOWED_ORIGINS=http://localhost,http://localhost:80 # CORS e WebSocket origin whitelist
  - TRUST_PROXY=true            # Richiesto dietro reverse proxy/load balancer
```

### Configurazione WebSocket lato client

Il frontend è configurabile attraverso il hook `useWebSocket`:

```javascript
// Personalizza l'URL e le opzioni
const websocket = useWebSocket('/socket.io', {
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});
```

### Configurazione Nginx per WebSocket

Il server Nginx è configurato per supportare WebSocket con timeout estesi:

```nginx
location /socket.io/ {
    proxy_pass http://backend:5000/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s; # 1h
}
```

## 🚧 Sviluppo futuro

Ecco alcune idee per il futuro sviluppo dell'applicazione:
- **Traduzione automatica**: Tradurre notizie da lingue diverse
- **Modalità dark**: Aggiungere un tema scuro per l'interfaccia
- **Miglioramento prestazioni AI**: Cache lato server multi-livello per ottimizzare le richieste RSS e AI
- **Dashboard analytics**: Creare una dashboard per analizzare tendenze delle notizie

## 🔧 Risoluzione problemi

### Errori di permessi (EACCES)

Se riscontri errori come `EACCES: permission denied` nei log del container backend, il problema è probabilmente legato ai permessi delle directory `logs` e `data`:

```
Error: EACCES: permission denied, open 'logs/application-YYYY-MM-DD.log'
```

**Soluzione**:
```bash
# Fermati tutti i container
docker-compose down

# Configura i permessi corretti
mkdir -p ./backend/logs ./backend/data
sudo chown -R 1001:1001 ./backend/logs ./backend/data
sudo chmod -R 775 ./backend/logs ./backend/data

# Riavvia l'applicazione
docker-compose up -d
```

### Problemi di connessione a Ollama

Se l'applicazione non riesce a connettersi al servizio Ollama, verifica:

1. Che il servizio Ollama sia attivo e funzionante
2. Che l'URL specificato in `OLLAMA_API_URL` sia corretto
3. Che la rete `ollama-network` esista e sia accessibile (solo se usi `docker-compose.ollama.yml`)

Se necessario, puoi:
- disabilitare temporaneamente l'integrazione impostando `USE_OLLAMA=false` nel file `docker-compose.yml`
- avviare senza file override `docker-compose.ollama.yml`

### Connessione WebSocket instabile

Se riscontri disconnessioni frequenti del WebSocket:

1. Verifica la configurazione di timeout nel `docker-compose.yml`
2. Controlla che il proxy Nginx sia configurato correttamente per WebSocket
3. Aumenta i valori di `WS_PING_TIMEOUT` e `WS_PING_INTERVAL` per reti meno stabili
