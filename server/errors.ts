export class ValidationError extends Error {
  statusCode = 400;
}

export class NotFoundError extends Error {
  statusCode = 404;
}
