import React, { memo } from 'react';

/**
 * Componente per visualizzare una singola card di notizia
 * Ottimizzato con memo per evitare rendering non necessari
 */
const NewsCard = memo(({ 
  group, 
  activeFilters, 
  toggleFilter
}) => {
  // Validazione input per prevenire errori
  if (!group || !group.items || group.items.length === 0) {
    return null;
  }

  // Arrotonda la data di pubblicazione alle prime due cifre significative
  const formatPublicationDate = (dateString) => {
    if (!dateString) return '';
    
    try {
      return new Date(dateString).toLocaleDateString('it-IT', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('Errore nel parsing della data:', error);
      return '';
    }
  };

  // Tronca il contenuto dell'articolo
  const truncateContent = (content, maxLength = 150) => {
    if (!content || typeof content !== 'string') return '';
    return content.length > maxLength ? `${content.substring(0, maxLength)}...` : content;
  };

  // Verifica se un topic è attivo nei filtri
  const isTopicActive = (topic) => {
    return activeFilters.topics.some(t => t.toLowerCase() === topic.toLowerCase());
  };

  return (
    <article className="bg-white rounded-lg shadow overflow-hidden h-full flex flex-col transition-shadow hover:shadow-md">
      {/* Intestazione card */}
      <div className="p-4 flex-grow">
        <h2 className="text-lg font-semibold">{group.title}</h2>
        <p className="text-gray-600 mt-1">{group.description}</p>
        
        {/* Fonti e data */}
        <div className="mt-2 flex flex-wrap gap-1">
          {group.sources && group.sources.map(source => (
            <span 
              key={source} 
              className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs"
              title={`Fonte: ${source}`}
            >
              {source}
            </span>
          ))}
          <span className="text-gray-500 text-xs ml-auto" title="Data di pubblicazione">
            {formatPublicationDate(group.pubDate)}
          </span>
        </div>
        
        {/* Argomenti */}
        {group.topics && group.topics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {group.topics.map(topic => (
              <button 
                key={topic} 
                className={`
                  ${isTopicActive(topic) ? 'bg-green-500 text-white' : 'bg-green-100 text-green-800'} 
                  px-2 py-1 rounded-full text-xs cursor-pointer hover:bg-green-200 transition-colors
                  focus:outline-none focus:ring-2 focus:ring-green-500
                `}
                onClick={() => toggleFilter('topics', topic)}
                aria-label={isTopicActive(topic) ? `Rimuovi filtro: ${topic}` : `Filtra per: ${topic}`}
                aria-pressed={isTopicActive(topic)}
              >
                {topic}
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Anteprima contenuto */}
      {group.items[0].content && (
        <div className="px-4 pb-2">
          <p className="text-gray-700" aria-label="Anteprima del contenuto">
            {truncateContent(group.items[0].content)}
          </p>
        </div>
      )}
      
      {/* Pulsanti azioni */}
      <div className="px-4 py-4 mt-auto border-t border-gray-100">
        <a
          href={group.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors
                   focus:outline-none focus:underline"
          aria-label={`Leggi l'articolo completo "${group.title}" sul sito originale`}
        >
          Leggi di più
        </a>
      </div>
    </article>
  );
});

// Nome del componente per il debugging con React DevTools
NewsCard.displayName = 'NewsCard';

export default NewsCard;