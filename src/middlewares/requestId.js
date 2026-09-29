const crypto = require('crypto');

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[\w-]{1,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

module.exports = { requestId };
