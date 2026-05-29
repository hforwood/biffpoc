import {
  param,
  rejectMethod,
  sendError,
  sendJson,
  syncProjectPayload,
  type ApiRequest,
  type ApiResponse
} from "../../../src/api-support.js";

export const maxDuration = 300;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== "POST") {
      rejectMethod(res);
      return;
    }

    sendJson(res, await syncProjectPayload(param(req, "projectId")));
  } catch (error) {
    sendError(res, error);
  }
}
