import React, { memo } from 'react';

/**
 * Componente per visualizzare una singola card di notizia
 * Ottimizzato con memo per evitare rendering non necessari
 * Modificato per:
 * - Non mostrare immagini
 * - Garantire sempre la presenza di un estratto quando disponibile
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

  // Ottiene il contenuto migliore disponibile tra description e content
  const getBestContent = () => {
    // Preferisci il content se disponibile e più lungo della description
    const mainItem = group.items[0];
    const content = mainItem.content || '';
    const description = mainItem.description || group.description || '';
    
    // Se il content è più lungo e significativo, usa quello
    if (content.length > 30 && content.length > description.length) {
      return content;
    }
    
    // Altrimenti usa la description
    return description;
  };

  // Tronca il contenuto dell'articolo ma garantisce una lunghezza minima se disponibile
  const truncateContent = (maxLength = 200) => {
    const content = getBestContent();
    
    if (!content || typeof content !== 'string') {
      return 'Nessun contenuto disponibile per questo articolo.';
    }
    
    // Pulisce il testo da eventuali tag HTML residui
    const cleanContent = content.replace(/<[^>]*>?/gm, '');
    
    // Garantisce una lunghezza minima di 100 caratteri se disponibile
    const minLength = Math.min(100, cleanContent.length);
    const actualMaxLength = Math.max(maxLength, minLength);
    
    return cleanContent.length > actualMaxLength 
      ? `${cleanContent.substring(0, actualMaxLength)}...` 
      : cleanContent;
  };

  // Verifica se un topic è attivo nei filtri
  const isTopicActive = (topic) => {
    return activeFilters.topics.some(t => t.toLowerCase() === topic.toLowerCase());
  };

  return (
    <article className="bg-white rounded-lg shadow overflow-hidden h-full flex flex-col transition-shadow hover:shadow-md">
      {/* Intestazione card */}
      <div className="p-4">
        <h2 className="text-lg font-semibold">{group.title}</h2>
        
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
      
      {/* Estratto del contenuto - sempre presente */}
      <div className="px-4 pb-4 flex-grow">
        <p className="text-gray-700" aria-label="Estratto del contenuto">
          {truncateContent(250)}
        </p>
      </div>
      
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