export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
  }
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  errorLabel = "API request"
): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new ApiError(`${errorLabel} failed with ${response.status}`, response.status, text);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function fetchBinary(
  url: string,
  init?: RequestInit,
  errorLabel = "API binary request"
): Promise<{ data: Buffer; contentType: string }> {
  const response = await fetch(url, init);
  const arrayBuffer = await response.arrayBuffer();
  const body = Buffer.from(arrayBuffer);

  if (!response.ok) {
    throw new ApiError(`${errorLabel} failed with ${response.status}`, response.status, body.toString("utf8"));
  }

  return {
    data: body,
    contentType: response.headers.get("content-type") ?? "application/octet-stream"
  };
}
