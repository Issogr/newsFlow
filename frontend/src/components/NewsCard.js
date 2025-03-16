import React, { useState, memo } from 'react';
import { Code } from 'lucide-react';

/**
 * Componente per visualizzare una singola card di notizia
 */
const NewsCard = memo(({ 
  group, 
  showDiff, 
  setShowDiff, 
  toggleFilter, 
  activeFilters, 
  generateDiff 
}) => {
  // Arrotonda la data di pubblicazione alle prime due cifre significative
  const formatPublicationDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Tronca il contenuto dell'articolo
  const truncateContent = (content, maxLength = 150) => {
    if (!content) return '';
    return content.length > maxLength ? `${content.substring(0, maxLength)}...` : content;
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Intestazione card */}
      <div className="p-4">
        <h2 className="text-lg font-semibold">{group.title}</h2>
        <p className="text-gray-600 mt-1">{group.description}</p>
        
        {/* Fonti e data */}
        <div className="mt-2 flex flex-wrap gap-1">
          {group.sources.map(source => (
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
                  ${activeFilters.topics.includes(topic) ? 'bg-green-500 text-white' : 'bg-green-100 text-green-800'} 
                  px-2 py-1 rounded-full text-xs cursor-pointer hover:bg-green-200
                `}
                onClick={() => {
                  if (!activeFilters.topics.includes(topic)) {
                    toggleFilter('topics', topic);
                  }
                }}
                aria-label={`Filtra per argomento: ${topic}`}
              >
                {topic}
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Anteprima contenuto */}
      <div className="px-4 pb-2">
        <p className="text-gray-700" aria-label="Anteprima del contenuto">
          {truncateContent(group.items[0].content)}
        </p>
      </div>
      
      {/* Pulsanti azioni */}
      <div className="px-4 pb-4 flex justify-between">
        <a
          href={group.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          aria-label="Leggi l'articolo completo sulla fonte originale"
        >
          Leggi di più
        </a>
        
        {/* Pulsante Diff (solo se ci sono più fonti) */}
        {group.items.length > 1 && (
          <button
            onClick={() => setShowDiff(showDiff === group.id ? null : group.id)}
            className="flex items-center text-purple-600 hover:text-purple-800 text-sm font-medium"
            aria-label={showDiff === group.id ? 'Nascondi differenze tra le fonti' : 'Mostra differenze tra le fonti'}
          >
            <Code className="h-4 w-4 mr-1" aria-hidden="true" />
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
                  <div 
                    className="bg-white p-2 rounded border text-xs font-mono whitespace-pre-wrap"
                    aria-label="Confronto tra le versioni dell'articolo"
                  >
                    {diff.map((part, partIdx) => (
                      <span 
                        key={partIdx} 
                        className={`
                          ${part.type === 'unchanged' ? 'text-gray-800' : ''}
                          ${part.type === 'added' ? 'bg-green-100 text-green-800' : ''}
                          ${part.type === 'removed' ? 'bg-red-100 text-red-800' : ''}
                        `}
                        aria-label={
                          part.type === 'unchanged' ? 'Testo presente in entrambe le fonti' :
                          part.type === 'added' ? 'Testo aggiunto nella seconda fonte' :
                          'Testo presente solo nella prima fonte'
                        }
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
  );
});

// Nome del componente per il debugging con React DevTools
NewsCard.displayName = 'NewsCard';

export default NewsCard;