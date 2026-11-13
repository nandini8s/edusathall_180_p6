function notFound(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  const status = error.statusCode || error.status || (error.name === "ValidationError" ? 400 : 500);
  const response = {
    success: false,
    error: { code: error.code || "INTERNAL_SERVER_ERROR", message: error.message || "An unexpected error occurred." },
  };
  if (error.name === "CastError") {
    response.error.code = "INVALID_ID";
    response.error.message = "The supplied report ID is invalid.";
    return res.status(400).json(response);
  }
  if (error.name === "ValidationError") response.error.code = "VALIDATION_ERROR";
  if (process.env.NODE_ENV !== "production" && status >= 500) response.error.details = error.message;
  return res.status(status).json(response);
}

module.exports = { notFound, errorHandler };
