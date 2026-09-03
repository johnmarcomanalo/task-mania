/** An error with an HTTP status; app.onError turns it into {message}. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Laravel's 422 shape: the first message is the headline, errors is per field. */
export class ValidationError extends Error {
  constructor(public errors: Record<string, string[]>) {
    super(Object.values(errors)[0]?.[0] ?? 'The given data was invalid.')
    this.name = 'ValidationError'
  }
}

export const notFound = () => new HttpError(404, 'Not found.')

export const invalid = (field: string, message: string) => new ValidationError({ [field]: [message] })
