const { ProxyAgent } = require('undici');
const { getEnv } = require('../config/env');

const proxyAgents = new Map();

function getProxyAgent(proxyUrl) {
  if (!proxyAgents.has(proxyUrl)) {
    proxyAgents.set(proxyUrl, new ProxyAgent(proxyUrl));
  }
  return proxyAgents.get(proxyUrl);
}

function fetchRdk(url, options = {}) {
  const { rdkHttpProxyUrl } = getEnv();
  if (!rdkHttpProxyUrl) return fetch(url, options);
  return fetch(url, { ...options, dispatcher: getProxyAgent(rdkHttpProxyUrl) });
}

module.exports = { fetchRdk };
