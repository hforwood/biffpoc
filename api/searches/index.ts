import {
  createSearchPayload,
  readJsonBody,
  rejectMethod,
  searchesPayload,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../../src/api-support.js";

export const maxDuration = 300;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === "GET") {
      sendJson(res, await searchesPayload());
      return;
    }

    if (req.method === "POST") {
      sendJson(res, await createSearchPayload(await readJsonBody(req)));
      return;
    }

    rejectMethod(res);
  } catch (error) {
    sendError(res, error);
  }
}
