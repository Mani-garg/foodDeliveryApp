function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `No route found for ${req.method} ${req.originalUrl}`,
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = err.statusCode || err.status || 500;
  const response = {
    error: err.name || 'InternalServerError',
    message: err.message || 'Unexpected server error',
  };

  if (process.env.NODE_ENV !== 'production' && err.details) {
    response.details = err.details;
  }

  return res.status(status).json(response);
}

module.exports = { errorHandler, notFoundHandler };
