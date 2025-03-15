const RSSParser = require('rss-parser');
const axios = require('axios');
const logger = require('../utils/logger');

const parser = new RSSParser({
  customFields: {
    item: [
      ['media:content', 'media'],
      ['media:thumbnail', 'thumbnail'],
      ['dc:creator', 'creator'],
      ['dc:date', 'dcdate']
    ]
  }
});

// Function to fetch and parse an RSS feed
async function parseFeed(source) {
  try {
    const response = await axios.get(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000 // 10 seconds timeout
    });
    
    const feed = await parser.parseString(response.data);
    
    // Map feed items to standardized format
    return feed.items.map(item => ({
      id: item.guid || item.id || `${source.id}-${item.link}`,
      title: item.title,
      description: item.description ? stripHtml(item.description) : '',
      content: item.content ? stripHtml(item.content) : (item['content:encoded'] ? stripHtml(item['content:encoded']) : ''),
      pubDate: item.pubDate || item.dcdate || item.isoDate || new Date().toISOString(),
      source: source.name,
      sourceId: source.id,
      url: item.link,
      topics: extractTopics(item),
      image: getImageUrl(item)
    }));
  } catch (error) {
    logger.error(`Error parsing feed from ${source.name} (${source.url}): ${error.message}`);
    return []; // Return empty array in case of error
  }
}

// Helper functions
function stripHtml(html) {
  return html.replace(/<\/?[^>]+(>|$)/g, "").trim();
}

function getImageUrl(item) {
  if (item.media && item.media.$ && item.media.$.url) {
    return item.media.$.url;
  }
  if (item.thumbnail && item.thumbnail.$ && item.thumbnail.$.url) {
    return item.thumbnail.$.url;
  }
  if (item.enclosure && item.enclosure.url) {
    return item.enclosure.url;
  }
  
  // Try to extract image from content
  const imgRegex = /<img.*?src=["'](.*?)["']/;
  const contentToSearch = item.content || item['content:encoded'] || item.description || '';
  const match = contentToSearch.match(imgRegex);
  return match ? match[1] : null;
}

function extractTopics(item) {
  const topics = [];
  
  // Extract from categories if available
  if (item.categories && Array.isArray(item.categories)) {
    topics.push(...item.categories);
  }
  
  // Extract common topics from title and description
  const commonTopics = [
    'Politica', 'Economia', 'Tecnologia', 'Scienza', 'Sport', 'Cultura', 'Salute', 
    'Ambiente', 'Esteri', 'Cronaca', 'Spettacolo', 'Politics', 'Economy', 'Technology',
    'Science', 'Sports', 'Culture', 'Health', 'Environment', 'International', 'Entertainment'
  ];
  
  const content = `${item.title} ${item.description || ''}`.toLowerCase();
  
  commonTopics.forEach(topic => {
    if (content.includes(topic.toLowerCase())) {
      topics.push(topic);
    }
  });
  
  return [...new Set(topics)]; // Remove duplicates
}

module.exports = { parseFeed };