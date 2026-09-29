function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

function errorHandler(error, req, res, _next) {
  let statusCode = error.statusCode || 500;
  let message = error.message || 'Internal server error.';

  if (error.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(error.errors).map((item) => item.message).join(' ');
  }
  if (error.name === 'MulterError') {
    statusCode = 400;
    message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Image size must be 5 MB or smaller.'
      : error.message;
  }
  if (error.name === 'CastError') {
    statusCode = 400;
    message = `${error.path} has an invalid value.`;
  }
  if (error.code === 11000) {
    statusCode = 409;
    message = 'A record with that value already exists.';
  }

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(req.requestId ? { requestId: req.requestId } : {})
  });
}

module.exports = { notFound, errorHandler };
