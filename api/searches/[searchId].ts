import {
  getSearchPayload,
  param,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../../src/api-support.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== "GET") {
      rejectMethod(res);
      return;
    }

    sendJson(res, await getSearchPayload(param(req, "searchId")));
  } catch (error) {
    sendError(res, error);
  }
}
