const { ProxyAgent } = require('undici');
const { getEnv } = require('../config/env');

let proxyAgent;
let configuredProxyUrl;

function fetchPi(url, options = {}) {
  const env = getEnv();
  // Render's shared Tailscale HTTP proxy can reach both gateways when the Pi
  // does not have a dedicated proxy configured.
  const proxyUrl = env.piHttpProxyUrl || env.rdkHttpProxyUrl;
  if (!proxyUrl) return fetch(url, options);
  if (configuredProxyUrl !== proxyUrl) {
    proxyAgent?.close().catch(() => {});
    proxyAgent = new ProxyAgent(proxyUrl);
    configuredProxyUrl = proxyUrl;
  }
  return fetch(url, { ...options, dispatcher: proxyAgent });
}

module.exports = { fetchPi };
