const handler = require('./agent-final');

module.exports = async function(req, res) {
  const originalUrl = req.url;
  try {
    const u = new URL(req.url || '/', 'https://x');
    u.pathname = '/a2a/message:send';
    req.url = u.pathname + (u.search || '');
    return await handler(req, res);
  } finally {
    req.url = originalUrl;
  }
};
