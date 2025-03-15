import React, { useState, useEffect } from 'react';
import { Search, Filter, Globe, RefreshCw, Code } from 'lucide-react';
import { fetchNews, searchNews, fetchHotTopics, fetchSources, fetchTopicMap } from '../services/api';
import ErrorMessage from './ErrorMessage';
import topicHelper from '../utils/topicHelper';

// Componente principale dell'applicazione
const NewsAggregator = () => {
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
  const [showDiff, setShowDiff] = useState(null);
  const [hotTopics, setHotTopics] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [topicMappings, setTopicMappings] = useState(null);

  // Sistema di caching per le notizie
  const CACHE_KEY = 'news_aggregator_cache';
  const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minuti di validità cache
  
  // Funzione per salvare i dati in cache
  const saveToCache = (data) => {
    const cacheData = {
      timestamp: Date.now(),
      news: data.news,
      sources: data.sources,
      topics: data.topics,
      topicMappings: data.topicMappings
    };
    
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      console.log('Dati salvati in cache');
    } catch (error) {
      console.error('Errore nel salvataggio della cache:', error);
    }
  };
  
  // Funzione per caricare i dati dalla cache
  const loadFromCache = () => {
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
  };

  // Funzione per recuperare le notizie dal backend
  const loadNews = async () => {
    setLoading(true);
    setError(null);
    
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
        
        setLoading(false);
        return;
      }
      
      // Altrimenti, carica dal server
      const newsData = await fetchNews();
      const sourcesData = await fetchSources();
      
      // Carica la mappa dei topic
      let topicMapData = null;
      try {
        topicMapData = await fetchTopicMap();
        setTopicMappings(topicMapData);
        topicHelper.setTopicMappings(topicMapData.mappings);
      } catch (topicMapError) {
        console.error('Errore nel caricamento della mappa dei topic:', topicMapError);
      }
      
      // Prova a caricare i topic caldi, ma non bloccare l'interfaccia se fallisce
      let hotTopicsData = [];
      try {
        hotTopicsData = await fetchHotTopics();
      } catch (topicError) {
        console.error('Errore nel caricamento dei topic caldi:', topicError);
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
      setHotTopics(hotTopicsData.map(t => t.topic));
      
      // Salva in cache
      saveToCache({
        news: newsData,
        sources: allSources,
        topics: uniqueTopics,
        topicMappings: topicMapData
      });
      
    } catch (error) {
      console.error("Errore nel recupero delle notizie:", error);
      setError(error);
      
      // Prova a caricare dalla cache anche se scaduta come fallback di emergenza
      const cachedData = localStorage.getItem(CACHE_KEY);
      if (cachedData) {
        try {
          const parsedCache = JSON.parse(cachedData);
          setNews(parsedCache.news);
          setFilteredNews(parsedCache.news);
          setTopics(parsedCache.topics);
          setSources(parsedCache.sources);
          setTopicMappings(parsedCache.topicMappings);
          
          if (parsedCache.topicMappings) {
            topicHelper.setTopicMappings(parsedCache.topicMappings.mappings);
          }
          
          // Mostra comunque il messaggio di errore, ma almeno visualizziamo i dati in cache
        } catch (cacheError) {
          // Se anche questo fallisce, lasciamo solo l'errore
          console.error("Errore nel caricamento della cache:", cacheError);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Funzione per gestire la ricerca
  const handleSearch = async () => {
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
          group.items.some(item => activeFilters.sources.includes(item.source))
        );
      }
      
      // Filtra per argomenti
      if (activeFilters.topics.length > 0) {
        filtered = filtered.filter(group => 
          activeFilters.topics.some(topic => topicHelper.groupHasTopic(group, topic))
        );
      }
      
      setFilteredNews(filtered);
    } catch (error) {
      console.error("Errore nella ricerca:", error);
      // Non impostiamo setError qui perché vogliamo mostrare un errore nella UI solo per errori critici
      // Per errori di ricerca, potremmo mostrare un messaggio meno invasivo
      alert("Errore durante la ricerca. Riprova più tardi.");
    } finally {
      setIsSearching(false);
    }
  };

  // Effetto per caricare le notizie all'avvio
  useEffect(() => {
    loadNews();
  }, []);

  // Effetto per gestire i filtri (quando cambiano i filtri o le notizie)
  useEffect(() => {
    // Gestisce i filtri immediati (senza ricerca)
    if (!searchQuery.trim()) {
      let filtered = [...news];
      
      // Filtra per fonti
      if (activeFilters.sources.length > 0) {
        filtered = filtered.filter(group => 
          group.items.some(item => activeFilters.sources.includes(item.source))
        );
      }
      
      // Filtra per argomenti (usando il helper che gestisce le varianti dei topic)
      if (activeFilters.topics.length > 0) {
        filtered = filtered.filter(group => 
          activeFilters.topics.some(topic => topicHelper.groupHasTopic(group, topic))
        );
      }
      
      setFilteredNews(filtered);
    }
  }, [news, activeFilters]);

  // Effetto per eseguire la ricerca quando cambia la query
  useEffect(() => {
    // Utilizzo un timeout per non eseguire la ricerca ad ogni digitazione
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim()) {
        handleSearch();
      }
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Gestisce il toggle di un filtro
  const toggleFilter = (type, value) => {
    setActiveFilters(prev => {
      const newFilters = { ...prev };
      if (newFilters[type].includes(value)) {
        newFilters[type] = newFilters[type].filter(item => item !== value);
      } else {
        newFilters[type] = [...newFilters[type], value];
      }
      return newFilters;
    });
  };

  // Gestisce il reset dei filtri
  const resetFilters = () => {
    setActiveFilters({ sources: [], topics: [] });
    setSearchQuery('');
  };

  // Funzione per generare il diff tra due testi
  const generateDiff = (text1, text2) => {
    // In un'implementazione reale, utilizzeremmo una libreria come diff o jsdiff
    // Questa è una versione semplificata
    
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
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-md">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold flex items-center">
            <Globe className="mr-2" />
            Aggregatore di Notizie
          </h1>
          <div className="flex items-center">
            <button 
              onClick={loadNews} 
              className="flex items-center bg-blue-700 hover:bg-blue-800 p-2 rounded"
              disabled={loading}
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
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
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Cerca in tutto il database..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border rounded"
                disabled={loading || error}
              />
              {isSearching && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <div className="animate-spin h-4 w-4 border-t-2 border-blue-500 rounded-full"></div>
                </div>
              )}
            </div>
            
            {/* Filtri */}
            <div className="flex items-center gap-2">
              <div className="bg-gray-100 p-2 rounded flex items-center">
                <Filter className="h-4 w-4 mr-1 text-gray-500" />
                <span className="text-sm text-gray-600">Filtri:</span>
              </div>
              
              {/* Dropdown per fonti */}
              <div className="relative">
                <select 
                  className="appearance-none bg-white border rounded p-2 pr-8 text-sm"
                  onChange={(e) => toggleFilter('sources', e.target.value)}
                  value=""
                  disabled={loading || error}
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
                  className="appearance-none bg-white border rounded p-2 pr-8 text-sm"
                  onChange={(e) => toggleFilter('topics', e.target.value)}
                  value=""
                  disabled={loading || error}
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
                className="bg-gray-200 hover:bg-gray-300 p-2 rounded text-sm"
                disabled={loading || error}
              >
                Reset
              </button>
            </div>
          </div>
          
          {/* Filtri attivi */}
          {(activeFilters.sources.length > 0 || activeFilters.topics.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {activeFilters.sources.map(source => (
                <div key={source} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm flex items-center">
                  {source}
                  <button 
                    onClick={() => toggleFilter('sources', source)}
                    className="ml-1 text-blue-500 hover:text-blue-700"
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
                    className="ml-1 text-green-500 hover:text-green-700"
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
                  onClick={() => {
                    // Ordina le notizie per data (più recenti prima)
                    const sorted = [...news].sort((a, b) => 
                      new Date(b.pubDate) - new Date(a.pubDate)
                    );
                    setFilteredNews(sorted);
                  }}
                  className="bg-purple-100 hover:bg-purple-200 text-purple-800 px-3 py-1 rounded-full text-sm flex items-center"
                  disabled={loading || error}
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
                    } px-3 py-1 rounded-full text-sm flex items-center`}
                    disabled={loading || error}
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
            <div className="flex justify-center items-center h-64">
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
                <div key={group.id} className="bg-white rounded-lg shadow overflow-hidden">
                  {/* Intestazione card */}
                  <div className="p-4">
                    <h2 className="text-lg font-semibold">{group.title}</h2>
                    <p className="text-gray-600 mt-1">{group.description}</p>
                    
                    {/* Fonti e data */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {group.sources.map(source => (
                        <span key={source} className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                          {source}
                        </span>
                      ))}
                      <span className="text-gray-500 text-xs ml-auto">
                        {new Date(group.pubDate).toLocaleDateString('it-IT', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    
                    {/* Argomenti */}
                    {group.topics && group.topics.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {group.topics.map(topic => (
                          <span 
                            key={topic} 
                            className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs cursor-pointer hover:bg-green-200"
                            onClick={() => {
                              if (!activeFilters.topics.includes(topic)) {
                                toggleFilter('topics', topic);
                              }
                            }}
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Anteprima contenuto */}
                  <div className="px-4 pb-2">
                    <p className="text-gray-700">
                      {group.items[0].content && group.items[0].content.substring(0, 150)}
                      {group.items[0].content && group.items[0].content.length > 150 ? '...' : ''}
                    </p>
                  </div>
                  
                  {/* Pulsanti azioni */}
                  <div className="px-4 pb-4 flex justify-between">
                    <a
                      href={group.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      Leggi di più
                    </a>
                    
                    {/* Pulsante Diff (solo se ci sono più fonti) */}
                    {group.items.length > 1 && (
                      <button
                        onClick={() => setShowDiff(showDiff === group.id ? null : group.id)}
                        className="flex items-center text-purple-600 hover:text-purple-800 text-sm font-medium"
                      >
                        <Code className="h-4 w-4 mr-1" />
                        {showDiff === group.id ? 'Nascondi diff' : 'Mostra diff'}
                      </button>
                    )}
                  </div>
                  
                  {/* Sezione Diff */}
                  {showDiff === group.id && group.items.length > 1 && (
                    <div className="border-t border-gray-200 p-4 bg-gray-50">
                      <h3 className="text-sm font-semibold mb-2">Differenze nel contenuto:</h3>
                      
                      {group.items.slice(0, 2).map((item, idx, items) => {
                        // Mostro il diff solo per i primi due articoli per semplicità
                        if (idx === 0 && items.length > 1) {
                          const diff = generateDiff(item.content, items[1].content);
                          
                          return (
                            <div key={item.id} className="text-sm">
                              <div className="flex justify-between mb-1">
                                <span className="font-medium">{item.source} vs {items[1].source}</span>
                              </div>
                              <div className="bg-white p-2 rounded border text-xs font-mono whitespace-pre-wrap">
                                {diff.map((part, partIdx) => (
                                  <span 
                                    key={partIdx} 
                                    className={`
                                      ${part.type === 'unchanged' ? 'text-gray-800' : ''}
                                      ${part.type === 'added' ? 'bg-green-100 text-green-800' : ''}
                                      ${part.type === 'removed' ? 'bg-red-100 text-red-800' : ''}
                                    `}
                                  >
                                    {part.text}{' '}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
      
      {/* Statistiche sulle performance */}
      <div className="bg-gray-100 border-t border-gray-200 p-2">
        <div className="container mx-auto flex justify-between items-center text-xs text-gray-500">
          <div>
            <span>Notizie totali: {news.length}</span>
            <span className="mx-2">|</span>
            <span>Notizie filtrate: {filteredNews.length}</span>
          </div>
          <div>
            {localStorage.getItem(CACHE_KEY) ? (
              <span className="flex items-center">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                Cache attiva (scade in {Math.max(0, Math.floor((JSON.parse(localStorage.getItem(CACHE_KEY)).timestamp + CACHE_EXPIRY - Date.now()) / 1000))}s)
              </span>
            ) : (
              <span className="flex items-center">
                <span className="w-2 h-2 bg-red-500 rounded-full mr-1"></span>
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