import {
  addMorePayload,
  param,
  readJsonBody,
  rejectMethod,
  sendError,
  sendJson,
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

    sendJson(res, await addMorePayload(param(req, "searchId"), await readJsonBody(req)));
  } catch (error) {
    sendError(res, error);
  }
}
