import {
  getOwnerProfilePayload,
  param,
  readJsonBody,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
  updateOwnerProfilePayload
} from "../../src/api-support.js";

export const maxDuration = 300;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === "GET") {
      sendJson(res, await getOwnerProfilePayload(param(req, "token")));
      return;
    }

    if (req.method === "PATCH") {
      sendJson(res, await updateOwnerProfilePayload(param(req, "token"), await readJsonBody(req)));
      return;
    }

    rejectMethod(res);
  } catch (error) {
    sendError(res, error);
  }
}
