const { URL } = require('url');

function isAllowedNavigation(candidateUrl, allowedOrigin) {
  if (!allowedOrigin) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(candidateUrl, allowedOrigin);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  return parsed.origin === allowedOrigin;
}

module.exports = { isAllowedNavigation };
