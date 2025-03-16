import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, Filter, Globe, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { fetchNews, searchNews, fetchHotTopics, fetchSources, fetchTopicMap } from '../services/api';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [hotTopics, setHotTopics] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Inizializza il WebSocket - IMPORTANTE: senza dipendenze
  const websocket = useWebSocket();

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
      
      // Prova a caricare i topic caldi
      let hotTopicsData = [];
      try {
        hotTopicsData = await fetchHotTopics();
      } catch (topicError) {
        console.error('Errore nel caricamento dei topic caldi:', topicError);
      }
      
      // Estrai i topic unici
      const uniqueTopics = topicHelper.extractUniqueTopics(newsData);
      
      // Estrai tutte le fonti uniche
      const allSources = sourcesData.map(source => source.name);
      
      // Imposta lo stato
      setNews(newsData);
      setFilteredNews(newsData);
      setSources(allSources);
      setTopics(uniqueTopics);
      setHotTopics(hotTopicsData.map(t => t.topic));
      
    } catch (error) {
      console.error("Errore nel recupero delle notizie:", error);
      setError(error);
    } finally {
      setLoading(false);
      // Marca che il caricamento iniziale è completato
      initialLoadDone.current = true;
    }
  }, [websocket]);

  // Funzione per gestire la ricerca
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      // Se la query è vuota, mostra tutte le notizie
      setFilteredNews(news);
      return;
    }
    
    setIsSearching(true);
    
    try {
      // Cerca nel database completo
      const searchResults = await searchNews(searchQuery);
      
      // Applica i filtri attuali ai risultati della ricerca
      let filtered = [...searchResults];
      
      // Filtra per fonti
      if (activeFilters.sources.length > 0) {
        filtered = filtered.filter(group => 
          group.items && group.items.some(item => activeFilters.sources.includes(item.source))
        );
      }
      
      // Filtra per argomenti - usando il topicHelper per la normalizzazione
      if (activeFilters.topics.length > 0) {
        filtered = filtered.filter(group => 
          activeFilters.topics.some(topic => topicHelper.groupHasTopic(group, topic))
        );
      }
      
      setFilteredNews(filtered);
    } catch (error) {
      console.error("Errore nella ricerca:", error);
      // Mostra un messaggio di errore meno invasivo per errori di ricerca
      alert(`Errore durante la ricerca: ${error.message || 'Riprova più tardi'}`);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, news, activeFilters]);

  // Effetto per caricare le notizie UNA sola volta all'avvio
  useEffect(() => {
    if (!initialLoadDone.current) {
      loadNews();
    }
  }, [loadNews]);

  // Effetto per gestire i filtri (quando cambiano i filtri o le notizie)
  useEffect(() => {
    // Salta se il caricamento non è stato completato
    if (!initialLoadDone.current) return;
    
    // Gestisce i filtri immediati (senza ricerca)
    if (!searchQuery.trim()) {
      // Se non ci sono notizie, non fare nulla
      if (!news.length) return;
      
      let filtered = [...news];
      
      // Filtra per fonti
      if (activeFilters.sources.length > 0) {
        filtered = filtered.filter(group => 
          group.items && group.items.some(item => activeFilters.sources.includes(item.source))
        );
      }
      
      // Filtra per argomenti
      if (activeFilters.topics.length > 0) {
        filtered = filtered.filter(group => 
          activeFilters.topics.some(topic => topicHelper.groupHasTopic(group, topic))
        );
      }
      
      setFilteredNews(filtered);
    }
  }, [news, activeFilters, searchQuery]);

  // Effetto per eseguire la ricerca quando cambia la query
  useEffect(() => {
    // Salta se il caricamento non è stato completato
    if (!initialLoadDone.current) return;
    
    // Utilizzo un timeout per non eseguire la ricerca ad ogni digitazione
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim()) {
        handleSearch();
      } else if (searchQuery === '') {
        // Se la query è vuota, resetta i risultati di ricerca
        setFilteredNews(news);
      }
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [searchQuery, handleSearch, news]);

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
    }
  }, [websocket.lastNewsUpdate]);

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

  // Gestisce il reset dei filtri
  const resetFilters = useCallback(() => {
    setActiveFilters({ sources: [], topics: [] });
    setSearchQuery('');
  }, []);

  // Ordina le notizie per data più recente
  const sortByDate = useCallback(() => {
    const sorted = [...filteredNews].sort((a, b) => 
      new Date(b.pubDate) - new Date(a.pubDate)
    );
    setFilteredNews(sorted);
  }, [filteredNews]);

  // Memorizza il calcolo della visibilità dei filtri attivi
  const hasActiveFilters = useMemo(() => 
    activeFilters.sources.length > 0 || activeFilters.topics.length > 0, 
    [activeFilters]
  );

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Centro notifiche */}
      <NotificationCenter
        notifications={websocket.notifications}
        onRemoveNotification={websocket.removeNotification}
        newArticlesCount={websocket.newArticlesCount}
        onRefresh={loadNews}
      />
      
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
      
      {/* Barra di ricerca e filtri */}
      <div className="bg-white p-4 shadow-sm">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Ricerca */}
            <div className="relative flex-grow">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center">
                <Search className="h-5 w-5 text-gray-400" aria-hidden="true" />
              </div>
              <input
                type="text"
                placeholder="Cerca in tutto il database..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading || Boolean(error)}
                aria-label="Cerca notizie"
              />
              {isSearching && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <div className="animate-spin h-4 w-4 border-t-2 border-blue-500 rounded-full" aria-hidden="true"></div>
                </div>
              )}
            </div>
            
            {/* Filtri */}
            <div className="flex items-center gap-2">
              <div className="bg-gray-100 p-2 rounded flex items-center" aria-hidden="true">
                <Filter className="h-4 w-4 mr-1 text-gray-500" />
                <span className="text-sm text-gray-600">Filtri:</span>
              </div>
              
              {/* Dropdown per fonti */}
              <div className="relative">
                <label htmlFor="source-filter" className="sr-only">Filtra per fonte</label>
                <select 
                  id="source-filter"
                  className="appearance-none bg-white border rounded p-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onChange={(e) => toggleFilter('sources', e.target.value)}
                  value=""
                  disabled={loading || Boolean(error)}
                >
                  <option value="" disabled>Fonti</option>
                  {sources.map(source => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
              </div>
              
              {/* Dropdown per argomenti */}
              <div className="relative">
                <label htmlFor="topic-filter" className="sr-only">Filtra per argomento</label>
                <select 
                  id="topic-filter"
                  className="appearance-none bg-white border rounded p-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onChange={(e) => toggleFilter('topics', e.target.value)}
                  value=""
                  disabled={loading || Boolean(error)}
                >
                  <option value="" disabled>Argomenti</option>
                  {topics.map(topic => (
                    <option key={topic} value={topic}>{topic}</option>
                  ))}
                </select>
              </div>
              
              {/* Pulsante reset filtri */}
              <button 
                onClick={resetFilters}
                className="bg-gray-200 hover:bg-gray-300 p-2 rounded text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
                disabled={loading || Boolean(error)}
                aria-label="Reimposta tutti i filtri"
              >
                Reset
              </button>
            </div>
          </div>
          
          {/* Filtri attivi */}
          {hasActiveFilters && (
            <div className="mt-2 flex flex-wrap gap-2" role="region" aria-label="Filtri attivi">
              {activeFilters.sources.map(source => (
                <div key={source} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm flex items-center">
                  {source}
                  <button 
                    onClick={() => toggleFilter('sources', source)}
                    className="ml-1 text-blue-500 hover:text-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded-full"
                    aria-label={`Rimuovi filtro fonte: ${source}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {activeFilters.topics.map(topic => (
                <div key={topic} className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm flex items-center">
                  {topic}
                  <button 
                    onClick={() => toggleFilter('topics', topic)}
                    className="ml-1 text-green-500 hover:text-green-700 focus:outline-none focus:ring-1 focus:ring-green-500 rounded-full"
                    aria-label={`Rimuovi filtro argomento: ${topic}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* Filtri rapidi */}
          {!error && (
            <div className="mt-3 border-t pt-3">
              <div className="flex flex-wrap gap-2">
                {/* Filtro per le notizie più recenti */}
                <button 
                  onClick={sortByDate}
                  className="bg-purple-100 hover:bg-purple-200 text-purple-800 px-3 py-1 rounded-full text-sm flex items-center transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
                  disabled={loading || Boolean(error)}
                  aria-label="Ordina per più recenti"
                >
                  Più recenti
                </button>
                
                {/* Topic caldi */}
                {hotTopics.map(topic => (
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
          )}
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