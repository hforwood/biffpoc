import {
  param,
  readJsonBody,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
  updateLeadReviewPayload
} from "../../../src/api-support.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== "PATCH") {
      rejectMethod(res);
      return;
    }

    sendJson(res, await updateLeadReviewPayload(param(req, "leadId"), await readJsonBody(req)));
  } catch (error) {
    sendError(res, error);
  }
}
