import {
  param,
  rejectMethod,
  sendError,
  sendImageAsset,
  type ApiRequest,
  type ApiResponse
} from "../../../src/api-support.js";

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      rejectMethod(res);
      return;
    }

    await sendImageAsset(res, param(req, "leadId"), param(req, "kind"));
  } catch (error) {
    sendError(res, error);
  }
}
