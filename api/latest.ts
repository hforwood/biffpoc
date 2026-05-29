import {
  latestPayload,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../src/api-support.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== "GET") {
      rejectMethod(res);
      return;
    }

    sendJson(res, await latestPayload());
  } catch (error) {
    sendError(res, error);
  }
}
