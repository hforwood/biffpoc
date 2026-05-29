import {
  param,
  readJsonBody,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
  updateContractorProjectSitePayload
} from "../../../../src/api-support.js";

export const maxDuration = 300;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== "PATCH") {
      rejectMethod(res);
      return;
    }

    sendJson(
      res,
      await updateContractorProjectSitePayload(param(req, "token"), param(req, "leadId"), await readJsonBody(req))
    );
  } catch (error) {
    sendError(res, error);
  }
}
