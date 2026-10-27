// An error the client is allowed to see: a status code and a plain message.
// Anything else that reaches the error handler is treated as a bug and answered with a generic 500.
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
