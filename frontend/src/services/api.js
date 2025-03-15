import axios from 'axios';

const api = axios.create({
  baseURL: '/api'
});

export const fetchNews = async () => {
  try {
    const response = await api.get('/news');
    return response.data;
  } catch (error) {
    console.error('Error fetching news:', error);
    throw error;
  }
};

export const searchNews = async (query) => {
  try {
    const response = await api.get(`/news/search?query=${encodeURIComponent(query)}`);
    return response.data;
  } catch (error) {
    console.error('Error searching news:', error);
    throw error;
  }
};

export const fetchHotTopics = async () => {
  try {
    const response = await api.get('/hot-topics');
    return response.data;
  } catch (error) {
    console.error('Error fetching hot topics:', error);
    throw error;
  }
};

export const fetchSources = async () => {
  try {
    const response = await api.get('/sources');
    return response.data;
  } catch (error) {
    console.error('Error fetching sources:', error);
    throw error;
  }
};

export const fetchTopicMap = async () => {
  try {
    const response = await api.get('/topics/map');
    return response.data;
  } catch (error) {
    console.error('Error fetching topic map:', error);
    throw error;
  }
};