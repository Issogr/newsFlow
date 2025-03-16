import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Filter, Globe, RefreshCw, X } from 'lucide-react';
import { fetchNews, searchNews, fetchHotTopics, fetchSources, fetchTopicMap } from '../services/api';
import useAsync from '../hooks/useAsync';
import ErrorMessage from './ErrorMessage';
import NewsCard from './NewsCard';
import topicHelper from '../utils/topicHelper';

// Componente principale dell'applicazione
const NewsAggregator = () => {
  // Stati
  const [news, setNews] = useState([]);
  const [filteredNews, setFilteredNews] = useState([]);
  const [sources, setSources] = useState([]);
  const [topics, setTopics] = useState([]);
  const [activeFilters, setActiveFilters] = useState({
    sources: [],
    topics: []
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [showDiff, setShowDiff] = useState(null);
  const [hotTopics, setHotTopics] = useState([]);
  const [topicMappings, setTopicMappings] = useState(null);

  // Sistema di caching per le notizie
  const CACHE_KEY = 'news_aggregator_cache';
  const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minuti di validità cache
  const MAX_CACHE_SIZE = 5 * 1024 * 1024; // 5MB limite dimensione cache
  
  // Hook asincrono per il caricamento delle notizie
  const {
    execute: executeLoadNews,
    status: newsStatus,
    error: newsError,
    isPending: isLoadingNews,
    retry: retryLoadNews
  } = useAsync(async () => {
    try {
      // Prova a caricare dalla cache
      const cachedData = loadFromCache();
      
      if (cachedData) {
        // Usa i dati dalla cache
        setNews(cachedData.news);
        setFilteredNews(cachedData.news);
        setSources(cachedData.sources);
        setTopics(cachedData.topics);
        setTopicMappings(cachedData.topicMappings);
        
        // Imposta i mapping dei topic nel helper
        if (cachedData.topicMappings) {
          topicHelper.setTopicMappings(cachedData.topicMappings.mappings);
        }
        
        return cachedData;
      }
      
      // Altrimenti, carica dal server
      const [newsData, sourcesData, topicMapData, hotTopicsData] = await Promise.all([
        fetchNews(),
        fetchSources(),
        fetchTopicMap().catch(err => {
          console.error('Errore nel caricamento della mappa dei topic:', err);
          return null;
        }),
        fetchHotTopics().catch(err => {
          console.error('Errore nel caricamento dei topic caldi:', err);
          return [];
        })
      ]);
      
      // Imposta i mapping dei topic nel helper se disponibili
      if (topicMapData) {
        topicHelper.setTopicMappings(topicMapData.mappings);
      }
      
      // Estrai i topic unici (già normalizzati dal backend)
      const uniqueTopics = topicHelper.extractUniqueTopics(newsData);
      
      // Estrai tutte le fonti uniche
      const allSources = sourcesData.map(source => source.name);
      
      // Imposta lo stato
      setNews(newsData);
      setFilteredNews(newsData);
      setSources(allSources);
      setTopics(uniqueTopics);
      setHotTopics(Array.isArray(hotTopicsData) ? hotTopicsData.map(t => t.topic) : []);
      setTopicMappings(topicMapData);
      
      // Salva in cache
      saveToCache({
        news: newsData,
        sources: allSources,
        topics: uniqueTopics,
        topicMappings: topicMapData
      });
      
      return { newsData, sourcesData, topicMapData, hotTopicsData };
    } catch (error) {
      console.error("Errore nel recupero delle notizie:", error);
      
      // Prova a caricare dalla cache anche se scaduta come fallback di emergenza
      const cachedData = loadFromCacheIgnoreExpiry();
      if (cachedData) {
        setNews(cachedData.news);
        setFilteredNews(cachedData.news);
        setSources(cachedData.sources);
        setTopics(cachedData.topics);
        setTopicMappings(cachedData.topicMappings);
        
        if (cachedData.topicMappings) {
          topicHelper.setTopicMappings(cachedData.topicMappings.mappings);
        }
      }
      
      throw error;
    }
  }, true);
  
  // Hook asincrono per la ricerca
  const {
    execute: executeSearch,
    isPending: isSearching
  } = useAsync(async (query) => {
    if (!query.trim()) {
      // Se la query è vuota, mostra tutte le notizie
      setFilteredNews(news);
      return news;
    }
    
    const searchResults = await searchNews(query);
    
    // Applica i filtri attuali ai risultati della ricerca
    const filtered = applyFilters(searchResults, activeFilters);
    setFilteredNews(filtered);
    
    return filtered;
  }, false);

  // Funzione per salvare i dati in cache
  const saveToCache = useCallback((data) => {
    try {
      const cacheData = {
        timestamp: Date.now(),
        news: data.news,
        sources: data.sources,
        topics: data.topics,
        topicMappings: data.topicMappings
      };
      
      const serializedData = JSON.stringify(cacheData);
      
      // Verifica la dimensione dei dati prima di salvarli
      const dataSize = new Blob([serializedData]).size;
      if (dataSize > MAX_CACHE_SIZE) {
        console.warn(`Dati troppo grandi per la cache (${dataSize} bytes). Limitato a ${MAX_CACHE_SIZE} bytes.`);
        return;
      }
      
      localStorage.setItem(CACHE_KEY, serializedData);
      console.log('Dati salvati in cache');
    } catch (error) {
      console.error('Errore nel salvataggio della cache:', error);
      
      // In caso di quota exceeded, prova a pulire la cache
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        try {
          localStorage.removeItem(CACHE_KEY);
          console.log('Cache precedente rimossa per liberare spazio');
        } catch (clearError) {
          console.error('Impossibile pulire la cache:', clearError);
        }
      }
    }
  }, [MAX_CACHE_SIZE]);
  
  // Funzione per caricare i dati dalla cache
  const loadFromCache = useCallback(() => {
    try {
      const cachedData = localStorage.getItem(CACHE_KEY);
      
      if (!cachedData) {
        console.log('Nessun dato in cache');
        return null;
      }
      
      const parsedCache = JSON.parse(cachedData);
      const now = Date.now();
      
      // Verifica se la cache è ancora valida
      if (now - parsedCache.timestamp > CACHE_EXPIRY) {
        console.log('Cache scaduta');
        return null;
      }
      
      console.log('Dati caricati dalla cache');
      return parsedCache;
    } catch (error) {
      console.error('Errore nel caricamento della cache:', error);
      return null;
    }
  }, [CACHE_EXPIRY]);
  
  // Funzione per caricare i dati dalla cache anche se scaduti (per fallback)
  const loadFromCacheIgnoreExpiry = useCallback(() => {
    try {
      const cachedData = localStorage.getItem(CACHE_KEY);
      
      if (!cachedData) {
        return null;
      }
      
      return JSON.parse(cachedData);
    } catch (error) {
      console.error('Errore nel caricamento della cache di fallback:', error);
      return null;
    }
  }, []);

  // Funzione per applicare i filtri ai dati
  const applyFilters = useCallback((newsData, filters) => {
    let filtered = [...newsData];
    
    // Filtra per fonti
    if (filters.sources.length > 0) {
      filtered = filtered.filter(group => 
        group.items.some(item => filters.sources.includes(item.source))
      );
    }
    
    // Filtra per argomenti
    if (filters.topics.length > 0) {
      filtered = filtered.filter(group => 
        filters.topics.some(topic => topicHelper.groupHasTopic(group, topic))
      );
    }
    
    return filtered;
  }, []);

  // Gestisce il toggle di un filtro
  const toggleFilter = useCallback((type, value) => {
    setActiveFilters(prev => {
      const newFilters = { ...prev };
      if (newFilters[type].includes(value)) {
        newFilters[type] = newFilters[type].filter(item => item !== value);
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

  // Funzione per ordinare le notizie per data
  const sortNewsByDate = useCallback(() => {
    const sorted = [...news].sort((a, b) => 
      new Date(b.pubDate) - new Date(a.pubDate)
    );
    setFilteredNews(sorted);
  }, [news]);
  
  // Memorizza i risultati filtrati quando cambiano i filtri o le notizie
  useEffect(() => {
    if (!searchQuery.trim()) {
      const filtered = applyFilters(news, activeFilters);
      setFilteredNews(filtered);
    }
  }, [news, activeFilters, applyFilters, searchQuery]);

  // Effetto per eseguire la ricerca quando cambia la query
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim()) {
        executeSearch(searchQuery);
      }
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [searchQuery, executeSearch]);

  // Funzione per generare il diff tra due testi
  const generateDiff = useCallback((text1, text2) => {
    if (!text1 || !text2 || typeof text1 !== 'string' || typeof text2 !== 'string') {
      return [{ type: 'unchanged', text: 'Contenuto non disponibile per il confronto' }];
    }
    
    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);
    
    const result = [];
    let i = 0, j = 0;
    
    while (i < words1.length || j < words2.length) {
      if (i >= words1.length) {
        // Testo 2 ha più parole
        result.push({ type: 'added', text: words2.slice(j).join(' ') });
        break;
      } else if (j >= words2.length) {
        // Testo 1 ha più parole
        result.push({ type: 'removed', text: words1.slice(i).join(' ') });
        break;
      } else if (words1[i] === words2[j]) {
        // Parole identiche
        result.push({ type: 'unchanged', text: words1[i] });
        i++;
        j++;
      } else {
        // Parole diverse
        let foundMatch = false;
        
        // Cerca la prossima corrispondenza
        for (let k = 1; k < 5 && i + k < words1.length; k++) {
          if (words1[i + k] === words2[j]) {
            // Trovata corrispondenza più avanti nel testo 1
            result.push({ type: 'removed', text: words1.slice(i, i + k).join(' ') });
            i += k;
            foundMatch = true;
            break;
          }
        }
        
        if (!foundMatch) {
          for (let k = 1; k < 5 && j + k < words2.length; k++) {
            if (words1[i] === words2[j + k]) {
              // Trovata corrispondenza più avanti nel testo 2
              result.push({ type: 'added', text: words2.slice(j, j + k).join(' ') });
              j += k;
              foundMatch = true;
              break;
            }
          }
        }
        
        if (!foundMatch) {
          // Nessuna corrispondenza trovata nelle prossime parole
          result.push({ type: 'removed', text: words1[i] });
          result.push({ type: 'added', text: words2[j] });
          i++;
          j++;
        }
      }
    }
    
    return result;
  }, []);

  // Tempo rimanente per la cache
  const cacheTimeRemaining = useMemo(() => {
    try {
      const cachedData = localStorage.getItem(CACHE_KEY);
      if (!cachedData) return 0;
      
      const { timestamp } = JSON.parse(cachedData);
      return Math.max(0, Math.floor((timestamp + CACHE_EXPIRY - Date.now()) / 1000));
    } catch (error) {
      return 0;
    }
  }, [CACHE_EXPIRY, newsStatus]); // Ricalcola quando lo stato delle notizie cambia

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-md">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold flex items-center">
            <Globe className="mr-2" aria-hidden="true" />
            Aggregatore di Notizie
          </h1>
          <div className="flex items-center">
            <button 
              onClick={retryLoadNews} 
              className="flex items-center bg-blue-700 hover:bg-blue-800 p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
              disabled={isLoadingNews}
              aria-label={isLoadingNews ? 'Caricamento in corso' : 'Aggiorna notizie'}
              aria-busy={isLoadingNews}
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${isLoadingNews ? 'animate-spin' : ''}`} aria-hidden="true" />
              {isLoadingNews ? 'Caricamento...' : 'Aggiorna'}
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
                disabled={isLoadingNews || newsError}
                aria-label="Cerca notizie"
              />
              {isSearching && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <div className="animate-spin h-4 w-4 border-t-2 border-blue-500 rounded-full" aria-hidden="true"></div>
                </div>
              )}
              {searchQuery && (
                <button
                  className="absolute inset-y-0 right-3 flex items-center"
                  onClick={() => setSearchQuery('')}
                  aria-label="Cancella ricerca"
                >
                  <X className="h-4 w-4 text-gray-400" aria-hidden="true" />
                </button>
              )}
            </div>
            
            {/* Filtri */}
            <div className="flex items-center gap-2">
              <div className="bg-gray-100 p-2 rounded flex items-center">
                <Filter className="h-4 w-4 mr-1 text-gray-500" aria-hidden="true" />
                <span className="text-sm text-gray-600">Filtri:</span>
              </div>
              
              {/* Dropdown per fonti */}
              <div className="relative">
                <select 
                  className="appearance-none bg-white border rounded p-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onChange={(e) => toggleFilter('sources', e.target.value)}
                  value=""
                  disabled={isLoadingNews || newsError}
                  aria-label="Filtra per fonte"
                >
                  <option value="" disabled>Fonti</option>
                  {sources.map(source => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
              </div>
              
              {/* Dropdown per argomenti */}
              <div className="relative">
                <select 
                  className="appearance-none bg-white border rounded p-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onChange={(e) => toggleFilter('topics', e.target.value)}
                  value=""
                  disabled={isLoadingNews || newsError}
                  aria-label="Filtra per argomento"
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
                className="bg-gray-200 hover:bg-gray-300 p-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                disabled={isLoadingNews || newsError}
                aria-label="Reimposta tutti i filtri"
              >
                Reset
              </button>
            </div>
          </div>
          
          {/* Filtri attivi */}
          {(activeFilters.sources.length > 0 || activeFilters.topics.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-2" aria-label="Filtri attivi">
              {activeFilters.sources.map(source => (
                <div key={source} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm flex items-center">
                  {source}
                  <button 
                    onClick={() => toggleFilter('sources', source)}
                    className="ml-1 text-blue-500 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 rounded-full"
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
                    className="ml-1 text-green-500 hover:text-green-700 focus:outline-none focus:ring-2 focus:ring-green-300 rounded-full"
                    aria-label={`Rimuovi filtro argomento: ${topic}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* Filtri rapidi */}
          {!newsError && (
            <div className="mt-3 border-t pt-3">
              <div className="flex flex-wrap gap-2">
                {/* Filtro per le notizie più recenti */}
                <button 
                  onClick={sortNewsByDate}
                  className="bg-purple-100 hover:bg-purple-200 text-purple-800 px-3 py-1 rounded-full text-sm flex items-center focus:outline-none focus:ring-2 focus:ring-purple-400"
                  disabled={isLoadingNews || newsError}
                  aria-label="Ordina per data più recente"
                >
                  Più recenti
                </button>
                
                {/* Topic caldi */}
                {hotTopics.map(topic => (
                  <button 
                    key={topic}
                    onClick={() => toggleFilter('topics', topic)}
                    className={`${
                      activeFilters.topics.includes(topic) 
                        ? 'bg-green-500 text-white' 
                        : 'bg-green-100 text-green-800 hover:bg-green-200'
                    } px-3 py-1 rounded-full text-sm flex items-center focus:outline-none focus:ring-2 focus:ring-green-400`}
                    disabled={isLoadingNews || newsError}
                    aria-label={`${activeFilters.topics.includes(topic) ? 'Rimuovi' : 'Aggiungi'} filtro argomento: ${topic}`}
                    aria-pressed={activeFilters.topics.includes(topic)}
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
          {isLoadingNews ? (
            <div 
              className="flex justify-center items-center h-64"
              role="status"
              aria-label="Caricamento notizie in corso"
            >
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
            </div>
          ) : newsError ? (
            <ErrorMessage 
              error={newsError} 
              onRetry={retryLoadNews}
            />
          ) : filteredNews.length === 0 ? (
            <div 
              className="bg-white rounded-lg shadow p-8 text-center"
              role="status"
              aria-live="polite"
            >
              <h2 className="text-xl text-gray-600">Nessuna notizia trovata</h2>
              <p className="mt-2 text-gray-500">Prova a modificare i filtri o aggiorna la pagina.</p>
            </div>
          ) : (
            <div 
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              aria-label={`Visualizzazione di ${filteredNews.length} notizie`}
            >
              {filteredNews.map(group => (
                <NewsCard
                  key={group.id}
                  group={group}
                  showDiff={showDiff}
                  setShowDiff={setShowDiff}
                  toggleFilter={toggleFilter}
                  activeFilters={activeFilters}
                  generateDiff={generateDiff}
                />
              ))}
            </div>
          )}
        </div>
      </main>
      
      {/* Statistiche sulle performance */}
      <div className="bg-gray-100 border-t border-gray-200 p-2">
        <div className="container mx-auto flex flex-wrap justify-between items-center text-xs text-gray-500">
          <div>
            <span>Notizie totali: {news.length}</span>
            <span className="mx-2">|</span>
            <span>Notizie filtrate: {filteredNews.length}</span>
          </div>
          <div>
            {cacheTimeRemaining > 0 ? (
              <span className="flex items-center">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-1" aria-hidden="true"></span>
                Cache attiva (scade in {cacheTimeRemaining}s)
              </span>
            ) : (
              <span className="flex items-center">
                <span className="w-2 h-2 bg-red-500 rounded-full mr-1" aria-hidden="true"></span>
                Cache non attiva
              </span>
            )}
          </div>
        </div>
      </div>
      
      <footer className="bg-gray-800 text-white p-4">
        <div className="container mx-auto text-center text-sm">
          <p>Aggregatore di Notizie - Creato con React</p>
          <p className="mt-1 text-gray-400">Caratteristiche avanzate: algoritmo TF-IDF per il raggruppamento delle notizie e sistema di caching per migliorare le performance.</p>
        </div>
      </footer>
    </div>
  );
};

export default NewsAggregator;