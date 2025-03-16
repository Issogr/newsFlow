import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Filter, Globe, RefreshCw, Wifi, WifiOff, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchNews, fetchHotTopics, fetchSources, fetchTopicMap } from '../services/api';
import ErrorMessage from './ErrorMessage';
import NewsCard from './NewsCard';
import NotificationCenter from './NotificationCenter';
import topicHelper from '../utils/topicHelper';
import useWebSocket from '../hooks/useWebSocket';

// Componente principale dell'applicazione
const NewsAggregator = () => {
  // Refs per evitare loop infiniti
  const initialLoadDone = useRef(false);
  const lastWebSocketUpdate = useRef(null);
  const lastTopicUpdate = useRef(null);
  const ignoreNextNewsUpdate = useRef(false);
  
  // Stati principali
  const [news, setNews] = useState([]);
  const [filteredNews, setFilteredNews] = useState([]);
  const [sources, setSources] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilters, setActiveFilters] = useState({
    sources: [],
    topics: []
  });
  const [showRecentOnly, setShowRecentOnly] = useState(false);
  
  // Stato per controllare se i filtri sono espansi o collassati
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  // Inizializza il WebSocket con l'URL base del browser
  const websocket = useWebSocket();

  // Monitor degli aggiornamenti WebSocket
  useEffect(() => {
    if (websocket.lastTopicUpdate) {
      console.log("WebSocket topic update ricevuto:", websocket.lastTopicUpdate);
    }
  }, [websocket.lastTopicUpdate]);

  useEffect(() => {
    if (websocket.lastNewsUpdate) {
      console.log("WebSocket news update ricevuto:", websocket.lastNewsUpdate);
    }
  }, [websocket.lastNewsUpdate]);

  // Funzione centrale per applicare i filtri a qualsiasi set di notizie
  // Questa funzione sarà riutilizzata in vari punti dell'applicazione
  const applyFilters = useCallback((newsToFilter) => {
    if (!newsToFilter || !Array.isArray(newsToFilter) || newsToFilter.length === 0) {
      return [];
    }
    
    let filtered = [...newsToFilter];
    
    // Filtra per fonti
    if (activeFilters.sources.length > 0) {
      filtered = filtered.filter(group => 
        group.items && group.items.some(item => activeFilters.sources.includes(item.source))
      );
    }
    
    // Filtra per argomenti utilizzando l'helper
    if (activeFilters.topics.length > 0) {
      filtered = filtered.filter(group => 
        activeFilters.topics.some(topic => topicHelper.groupHasTopic(group, topic))
      );
    }
    
    // Filtra per notizie recenti (ultime 3 ore)
    if (showRecentOnly) {
      const threeHoursAgo = new Date();
      threeHoursAgo.setHours(threeHoursAgo.getHours() - 3);
      
      filtered = filtered.filter(group => {
        const pubDate = new Date(group.pubDate);
        return pubDate >= threeHoursAgo;
      });
    }
    
    return filtered;
  }, [activeFilters, showRecentOnly]);

  useEffect(() => {
    if (websocket.isConnected) {
      console.log("WebSocket connesso. Stato attuale:", {
        isConnected: websocket.isConnected,
        updatesReceived: websocket.updatesReceived,
        notifications: websocket.notifications.length,
        activeFilters
      });
      
      // Invia filtri iniziali al server WebSocket
      websocket.updateSubscriptionFilters({
        topics: activeFilters.topics,
        sources: activeFilters.sources
      });
    }
  }, [websocket.isConnected, activeFilters]);

  // Funzione per recuperare le notizie dal backend
  const loadNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    websocket.resetNewArticlesCount();
    
    try {
      // Carica i dati direttamente dal server
      const newsData = await fetchNews();
      const sourcesData = await fetchSources();
      
      // Carica la mappa dei topic
      let topicMapData = null;
      try {
        topicMapData = await fetchTopicMap();
        topicHelper.setTopicMappings(topicMapData.mappings);
      } catch (topicMapError) {
        console.error('Errore nel caricamento della mappa dei topic:', topicMapError);
      }
      
      // Estrai i topic unici
      const uniqueTopics = topicHelper.extractUniqueTopics(newsData);
      
      // Estrai tutte le fonti uniche
      const allSources = sourcesData.map(source => source.name);
      
      // Imposta lo stato di tutte le news
      setNews(newsData);
      
      // Applica i filtri attivi ai dati appena caricati
      const filteredData = applyFilters(newsData);
      setFilteredNews(filteredData);
      
      setSources(allSources);
      setTopics(uniqueTopics);

      console.log("Dati caricati:", newsData);
      console.log("Dati filtrati:", filteredData);
      
    } catch (error) {
      console.error("Errore nel recupero delle notizie:", error);
      setError(error);
    } finally {
      setLoading(false);
      // Marca che il caricamento iniziale è completato
      initialLoadDone.current = true;
      
      // Imposta il flag per ignorare il prossimo aggiornamento websocket
      // poiché abbiamo appena caricato tutti i dati
      ignoreNextNewsUpdate.current = true;
    }
  }, [websocket, applyFilters]);

  // Effetto per caricare le notizie UNA sola volta all'avvio
  useEffect(() => {
    if (!initialLoadDone.current) {
      loadNews();
    }
  }, [loadNews]);

  // Effetto per ri-applicare i filtri quando cambiano i filtri attivi
  useEffect(() => {
    // Salta se il caricamento non è stato completato
    if (!initialLoadDone.current) return;
    
    // Applica i filtri alle notizie
    const filtered = applyFilters(news);
    setFilteredNews(filtered);
    
    console.log("Filtri applicati:", {
      sourcesFilters: activeFilters.sources,
      topicsFilters: activeFilters.topics,
      showRecentOnly,
      risultatiFiltrati: filtered.length
    });
    
  }, [activeFilters, news, applyFilters, showRecentOnly]);

  // Gestione filtri WebSocket - Una volta sola quando cambiano i filtri
  useEffect(() => {
    // Salta se il caricamento non è stato completato
    if (!initialLoadDone.current) return;
    
    // Aggiorna i filtri di sottoscrizione WebSocket
    if (websocket.isConnected) {
      websocket.updateSubscriptionFilters({
        topics: activeFilters.topics,
        sources: activeFilters.sources
      });
    }
  }, [activeFilters, websocket.isConnected]);

  // Gestione aggiornamenti WebSocket per nuovi articoli
  useEffect(() => {
    // Salta se il caricamento non è stato completato
    if (!initialLoadDone.current) return;
    
    // Preveniamo loop: se l'update è lo stesso dell'ultimo processato, ignoriamo
    if (
      websocket.lastNewsUpdate && 
      lastWebSocketUpdate.current !== websocket.lastNewsUpdate.timestamp
    ) {
      // Aggiorna il riferimento all'ultimo update processato
      lastWebSocketUpdate.current = websocket.lastNewsUpdate.timestamp;
      console.log('Nuovi articoli disponibili:', websocket.lastNewsUpdate.count);
      
      // Se abbiamo appena caricato tutti i dati, ignoriamo questo aggiornamento
      if (ignoreNextNewsUpdate.current) {
        ignoreNextNewsUpdate.current = false;
      }
    }
  }, [websocket.lastNewsUpdate]);

  // Gestione aggiornamenti topic via WebSocket
  useEffect(() => {
    // Salta se il caricamento non è stato completato o se non c'è un update
    if (!initialLoadDone.current || !websocket.lastTopicUpdate) return;
    
    // Evita di elaborare lo stesso aggiornamento più volte
    if (
      lastTopicUpdate.current === websocket.lastTopicUpdate.timestamp || 
      !websocket.lastTopicUpdate.articleId ||
      !websocket.lastTopicUpdate.topics
    ) {
      return;
    }
    
    // Aggiorna il riferimento all'ultimo update elaborato
    lastTopicUpdate.current = websocket.lastTopicUpdate.timestamp;
    
    const { articleId, topics } = websocket.lastTopicUpdate;
    console.log(`Ricevuto aggiornamento topic per articolo ${articleId}:`, topics);
    
    // Funzione migliorata per trovare corrispondenze di ID articoli
    const normalizeArticleId = (id) => id?.toString().trim().toLowerCase() || '';
    
    const articleIdsMatch = (id1, id2) => {
      const normalizedId1 = normalizeArticleId(id1);
      const normalizedId2 = normalizeArticleId(id2);
      
      if (!normalizedId1 || !normalizedId2 || normalizedId1.length < 5 || normalizedId2.length < 5) {
        return false;
      }
      
      // Corrispondenza esatta
      if (normalizedId1 === normalizedId2) return true;
      
      // Calcola la lunghezza per confronto parziale
      const longerLength = Math.max(normalizedId1.length, normalizedId2.length);
      const shorterLength = Math.min(normalizedId1.length, normalizedId2.length);
      
      // Richiede almeno 70% di corrispondenza nella lunghezza prima di controllare inclusione
      if (shorterLength / longerLength >= 0.7) {
        return normalizedId1.includes(normalizedId2) || normalizedId2.includes(normalizedId1);
      }
      
      return false;
    };
    
    // Cerca articoli corrispondenti
    const findArticleMatches = (articles, targetId) => {
      const matches = [];
      
      articles.forEach((group, groupIndex) => {
        group.items.forEach((item, itemIndex) => {
          if (articleIdsMatch(item.id, targetId) || 
              (item.url && articleIdsMatch(item.url, targetId))) {
            matches.push({
              groupIndex,
              itemIndex,
              groupId: group.id,
              itemId: item.id,
              url: item.url
            });
          }
        });
      });
      
      return matches;
    };
    
    // Cerca corrispondenze
    const matches = findArticleMatches(news, articleId);
    console.log("Corrispondenze trovate:", matches);
    
    if (matches.length > 0) {
      // Aggiorna gli articoli
      setNews(prevNews => {
        // Crea una copia profonda dell'array di news
        const updatedNews = [...prevNews];
        let updated = false;
        
        // Aggiorna ogni corrispondenza trovata
        matches.forEach(match => {
          const group = updatedNews[match.groupIndex];
          const item = { ...group.items[match.itemIndex] };
          
          // Combina i topic esistenti con quelli nuovi, evitando duplicati
          const existingTopics = Array.isArray(item.topics) ? item.topics : [];
          const combinedTopics = [...new Set([...existingTopics, ...topics])];
          item.topics = combinedTopics;
          
          // Aggiorna l'item nell'array
          const updatedItems = [...group.items];
          updatedItems[match.itemIndex] = item;
          
          // Aggiorna anche i topic a livello di gruppo
          const groupTopics = Array.isArray(group.topics) ? group.topics : [];
          const updatedGroupTopics = [...new Set([...groupTopics, ...topics])];
          
          // Crea un nuovo oggetto gruppo con gli items e i topics aggiornati
          updatedNews[match.groupIndex] = {
            ...group,
            items: updatedItems,
            topics: updatedGroupTopics
          };
          
          console.log(`Topic aggiornati per il gruppo ${group.id}:`, updatedGroupTopics);
          updated = true;
        });
        
        // Aggiorna anche l'elenco globale dei topic disponibili
        if (updated) {
          setTopics(prevTopics => {
            const allTopics = [...prevTopics, ...topics];
            return [...new Set(allTopics)].sort();
          });
          
          // Dopo aver aggiornato le news, riapplica i filtri
          // in modo asincrono per evitare problemi di stato
          setTimeout(() => {
            setFilteredNews(currentFiltered => {
              // Se non ci sono filtri attivi, non facciamo nulla
              if (activeFilters.sources.length === 0 && activeFilters.topics.length === 0 && !showRecentOnly) {
                return currentFiltered;
              }
              return applyFilters(updatedNews);
            });
          }, 0);
        }
        
        // Restituisci il nuovo array di news
        return updated ? updatedNews : prevNews;
      });
    }
    
  }, [websocket.lastTopicUpdate, activeFilters, applyFilters, showRecentOnly]);

  // Debug per monitorare i cambiamenti negli articoli
  useEffect(() => {
    if (initialLoadDone.current && websocket.lastTopicUpdate) {
      console.log("Cercando di aggiornare l'articolo con ID:", websocket.lastTopicUpdate.articleId);
      
      // Verifica se l'articolo è presente nel nostro stato
      let found = false;
      news.forEach(group => {
        group.items.forEach(item => {
          if (item.id === websocket.lastTopicUpdate.articleId || 
              (item.url && item.url.includes(websocket.lastTopicUpdate.articleId))) {
            console.log("Articolo trovato!", item);
            found = true;
          }
        });
      });
      
      console.log("Articolo trovato nel nostro stato:", found);
    }
  }, [websocket.lastTopicUpdate, news]);

  // Gestisce il toggle di un filtro
  const toggleFilter = useCallback((type, value) => {
    if (!value || typeof value !== 'string') return;
    
    setActiveFilters(prev => {
      const newFilters = { ...prev };
      
      // Verifica se il valore esiste già (case-insensitive)
      const valueIndex = newFilters[type].findIndex(
        item => item.toLowerCase() === value.toLowerCase()
      );
      
      if (valueIndex >= 0) {
        newFilters[type] = [
          ...newFilters[type].slice(0, valueIndex),
          ...newFilters[type].slice(valueIndex + 1)
        ];
      } else {
        newFilters[type] = [...newFilters[type], value];
      }
      
      return newFilters;
    });
  }, []);

  // Gestisce il toggle del filtro "ultime 3 ore"
  const toggleRecentFilter = useCallback(() => {
    setShowRecentOnly(prev => !prev);
  }, []);

  // Gestisce il toggle dell'espansione/collasso dei filtri
  const toggleFiltersExpanded = useCallback(() => {
    setFiltersExpanded(prev => !prev);
  }, []);

  // Gestisce il reset dei filtri
  const resetFilters = useCallback(() => {
    setActiveFilters({ sources: [], topics: [] });
    setShowRecentOnly(false);
  }, []);

  // Memorizza il calcolo della visibilità dei filtri attivi
  const hasActiveFilters = useMemo(() => 
    activeFilters.sources.length > 0 || activeFilters.topics.length > 0 || showRecentOnly, 
    [activeFilters, showRecentOnly]
  );

  // Calcola il numero di filtri attivi per mostrarlo nell'intestazione
  const activeFiltersCount = useMemo(() => {
    let count = activeFilters.topics.length + activeFilters.sources.length;
    if (showRecentOnly) count++;
    return count;
  }, [activeFilters, showRecentOnly]);

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-md">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold flex items-center">
            <Globe className="mr-2" aria-hidden="true" />
            Aggregatore di Notizie
          </h1>
          <div className="flex items-center gap-2">
            {/* Indicatore WebSocket */}
            <div className="flex items-center mr-2">
              {websocket.isConnected ? (
                <Wifi className="h-5 w-5 text-green-300" aria-hidden="true" title="Aggiornamenti in tempo reale attivi" />
              ) : (
                <WifiOff className="h-5 w-5 text-red-300" aria-hidden="true" title="Aggiornamenti in tempo reale non disponibili" />
              )}
            </div>
            
            {/* Centro notifiche */}
            <NotificationCenter
              notifications={websocket.notifications}
              onRemoveNotification={websocket.removeNotification}
              newArticlesCount={websocket.newArticlesCount}
              onRefresh={loadNews}
              isConnected={websocket.isConnected}
            />
            
            <button 
              onClick={loadNews} 
              className="flex items-center bg-blue-700 hover:bg-blue-800 p-2 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-white"
              disabled={loading}
              aria-label={loading ? 'Caricamento in corso...' : 'Aggiorna le notizie'}
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {loading ? 'Caricamento...' : 'Aggiorna'}
            </button>
          </div>
        </div>
      </header>
      
      {/* Filtri a chips con header collassabile */}
      <div className="bg-white shadow-sm">
        {/* Intestazione cliccabile dei filtri */}
        <div 
          className="container mx-auto p-4 cursor-pointer border-b border-gray-200"
          onClick={toggleFiltersExpanded}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-gray-500" aria-hidden="true" />
              <h2 className="text-lg font-medium text-gray-700">Filtri</h2>
              {activeFiltersCount > 0 && (
                <span className="bg-blue-500 text-white text-xs font-semibold rounded-full px-2 py-1 ml-2">
                  {activeFiltersCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasActiveFilters && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation(); // Impedisce a questo click di propagarsi all'header e causare il toggle
                    resetFilters();
                  }}
                  className="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
                  disabled={loading || Boolean(error)}
                  aria-label="Reimposta tutti i filtri"
                >
                  Reset
                </button>
              )}
              {filtersExpanded ? (
                <ChevronUp className="h-5 w-5 text-gray-500" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-500" aria-hidden="true" />
              )}
            </div>
          </div>
        </div>
        
        {/* Contenuto dei filtri (collassabile) */}
        <div className={`container mx-auto overflow-hidden transition-all duration-300 ${filtersExpanded ? 'max-h-screen p-4' : 'max-h-0 p-0'}`}>
          {/* Filtro temporale */}
          <div className="mb-3">
            <button 
              onClick={toggleRecentFilter}
              className={`${
                showRecentOnly
                  ? 'bg-purple-500 text-white' 
                  : 'bg-purple-100 text-purple-800 hover:bg-purple-200'
              } px-3 py-1 rounded-full text-sm flex items-center transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500`}
              disabled={loading || Boolean(error)}
              aria-label={showRecentOnly ? 'Mostra tutte le notizie' : 'Mostra solo le notizie delle ultime 3 ore'}
              aria-pressed={showRecentOnly}
            >
              <Clock className="h-4 w-4 mr-1" aria-hidden="true" />
              Ultime 3 ore
            </button>
          </div>
          
          {/* Argomenti (Topics) */}
          <div className="mb-3">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Argomenti:</h3>
            <div className="flex flex-wrap gap-2">
              {topics.map(topic => (
                <button 
                  key={topic}
                  onClick={() => toggleFilter('topics', topic)}
                  className={`${
                    activeFilters.topics.some(t => t.toLowerCase() === topic.toLowerCase())
                      ? 'bg-green-500 text-white' 
                      : 'bg-green-100 text-green-800 hover:bg-green-200'
                  } px-3 py-1 rounded-full text-sm flex items-center transition-colors focus:outline-none focus:ring-2 focus:ring-green-500`}
                  disabled={loading || Boolean(error)}
                  aria-label={
                    activeFilters.topics.some(t => t.toLowerCase() === topic.toLowerCase())
                      ? `Rimuovi filtro topic: ${topic}`
                      : `Filtra per topic: ${topic}`
                  }
                  aria-pressed={activeFilters.topics.some(t => t.toLowerCase() === topic.toLowerCase())}
                >
                  {topic}
                </button>
              ))}
            </div>
          </div>
          
          {/* Fonti (Sources) */}
          <div className="mb-3">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Fonti:</h3>
            <div className="flex flex-wrap gap-2">
              {sources.map(source => (
                <button 
                  key={source}
                  onClick={() => toggleFilter('sources', source)}
                  className={`${
                    activeFilters.sources.includes(source)
                      ? 'bg-blue-500 text-white' 
                      : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                  } px-3 py-1 rounded-full text-sm flex items-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  disabled={loading || Boolean(error)}
                  aria-label={
                    activeFilters.sources.includes(source)
                      ? `Rimuovi filtro fonte: ${source}`
                      : `Filtra per fonte: ${source}`
                  }
                  aria-pressed={activeFilters.sources.includes(source)}
                >
                  {source}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Contenuto principale */}
      <main className="flex-grow overflow-auto p-4">
        <div className="container mx-auto">
          {loading ? (
            <div className="flex justify-center items-center h-64" role="status" aria-label="Caricamento notizie in corso">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
            </div>
          ) : error ? (
            <ErrorMessage 
              error={error} 
              onRetry={loadNews}
            />
          ) : filteredNews.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <h2 className="text-xl text-gray-600">Nessuna notizia trovata</h2>
              <p className="mt-2 text-gray-500">Prova a modificare i filtri o aggiorna la pagina.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredNews.map(group => (
                <NewsCard 
                  key={group.id} 
                  group={group}
                  activeFilters={activeFilters}
                  toggleFilter={toggleFilter}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      
      {/* Piè di pagina */}
      <footer className="bg-gray-800 text-white p-4">
        <div className="container mx-auto text-center text-sm">
          <p>Aggregatore di Notizie - Creato con React</p>
          <p className="mt-1 text-gray-400">
            Caratteristiche avanzate: aggiornamenti in tempo reale, raggruppamento articoli e analisi topic
            {websocket.isConnected && (
              <span className="ml-2 text-green-400">
                ({websocket.updatesReceived} aggiornamenti ricevuti)
              </span>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default NewsAggregator;