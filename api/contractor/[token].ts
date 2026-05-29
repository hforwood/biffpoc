import {
  contractorProjectPayload,
  param,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../../src/api-support.js";

export const maxDuration = 300;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== "GET") {
      rejectMethod(res);
      return;
    }

    sendJson(res, await contractorProjectPayload(param(req, "token")));
  } catch (error) {
    sendError(res, error);
  }
}
