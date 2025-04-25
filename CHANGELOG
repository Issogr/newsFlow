# Changelog - Bugfix & Improvements v1.1.0

## 🛠️ Bug Fixes

### Critical Fixes

1. **Memory Leak nel Processore Asincrono (`backend/services/asyncProcessor.js`)**
   - Implementata pulizia proattiva dei job quando si raggiunge l'80% della capacità massima
   - Aggiunto sistema di persistenza debounced dei topic per evitare scritture eccessive su disco
   - Migliorato il monitoraggio della coda di job con logging dettagliato
   - Fix: prevenzione crescita incontrollata in memoria dei job inattivi

2. **Vulnerabilità XSS nel Sanitizzatore HTML (`backend/utils/inputValidator.js`)**
   - Sostituito sanitizzatore basato su regex con DOMPurify (richiede l'installazione di dompurify e jsdom)
   - Implementata white-list di tag e attributi consentiti
   - Rafforzata la sanitizzazione di URL in tag img e a
   - Aggiunto attributo rel="noopener noreferrer" automatico ai link esterni
   - Fix: prevenzione attacchi XSS attraverso payload HTML dannosi

3. **Race Condition negli Aggiornamenti WebSocket (`frontend/src/components/NewsAggregator.js`)**
   - Implementata corretta logica di aggiornamento interfaccia quando arrivano nuovi articoli
   - Fix: prima gli aggiornamenti websocket venivano notificati ma non applicati nell'interfaccia

### Reliability Improvements

4. **Gestione Connessione WebSocket Non Affidabile (`frontend/src/hooks/useWebSocket.js`)**
   - Aggiunto sistema di rilevamento timeout per il meccanismo ping/pong
   - Implementata rilevazione connessioni "zombie" e riconnessione automatica
   - Introdotti health check periodici con timeout per verificare lo stato della connessione
   - Fix: rilevazione più affidabile delle disconnessioni websocket

5. **Perdita di Sincronizzazione Filtri dopo Riconnessione (`frontend/src/components/NewsAggregator.js`)**
   - Aggiunto evento di riconnessione per triggerare la risincronizzazione dei filtri
   - Fix: dopo una riconnessione i filtri attivi venivano persi lato server

6. **Eventi WebSocket Multipli in Caso di Riconnessione (`frontend/src/hooks/useWebSocket.js`)**
   - Completamente rivista gestione registrazione/pulizia listener eventi
   - Centralizzati riferimenti alle funzioni handler per evitare duplicazioni
   - Fix: prevenzione accumulo di listener multipli che causavano eventi duplicati

## 🚀 Miglioramenti

### Performance & Scalability

7. **Sincronizzazione Backend dei Topic (`backend/services/asyncProcessor.js`)**
   - Introdotto sistema debounced per ottimizzare la persistenza su disco
   - Aggiunto flag di stato "dirty" per evitare scritture non necessarie
   - Migliorato sistema di gestione della cache in memoria

8. **Limitazione Rate Ottimizzata (`backend/server.js`)**
   - Implementati rate limiter separati e granulari per diverse operazioni:
     - Limitazione base per le API generali (200 richieste/15 min)
     - Limitazione specifica per ricerca (30 richieste/5 min)
     - Limitazione dedicata per operazioni di refresh (3 richieste/min)
     - Limitazione specifica per operazioni WebSocket (60 richieste/5 min)
   - Fix: prevenzione attacchi flood su API sensibili o resource-intensive

9. **Algoritmo di Raggruppamento News Migliorato (`backend/services/newsAggregator.js`)**
   - Rivista la funzione di calcolo similarità con:
     - Peso differenziato per titolo (60%), contenuto (20%) e topic (20%)
     - Selezione del gruppo con migliore similarità invece del primo match
     - Ottimizzazione calcolo di intersezioni per set di grandi dimensioni
   - Aggiunto logging di statistica per monitorare efficacia del raggruppamento
   - Fix: raggruppamento più preciso e semanticamente significativo

10. **Gestione Errori Broadcast WebSocket (`backend/services/websocketService.js`)**
    - Introdotte funzioni di broadcast sicuro con gestione errori individuale
    - Implementato fallback per invio notifiche quando fallisce il broadcast globale
    - Aggiunto monitoraggio dettagliato della dimensione delle stanze
    - Migliorata gestione delle statistiche di trasmissione
