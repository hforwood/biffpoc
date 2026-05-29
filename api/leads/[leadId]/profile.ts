import {
  getLeadProfilePayload,
  param,
  readJsonBody,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
  updateLeadProfilePayload
} from "../../../src/api-support.js";

export const maxDuration = 300;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === "GET") {
      sendJson(res, await getLeadProfilePayload(param(req, "leadId")));
      return;
    }

    if (req.method === "PATCH") {
      sendJson(res, await updateLeadProfilePayload(param(req, "leadId"), await readJsonBody(req)));
      return;
    }

    rejectMethod(res);
  } catch (error) {
    sendError(res, error);
  }
}
