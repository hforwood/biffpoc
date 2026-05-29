import {
  deleteProjectPayload,
  getProjectPayload,
  param,
  readJsonBody,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse,
  updateProjectPayload
} from "../../src/api-support.js";

export const maxDuration = 300;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === "GET") {
      sendJson(res, await getProjectPayload(param(req, "projectId")));
      return;
    }

    if (req.method === "PATCH") {
      sendJson(res, await updateProjectPayload(param(req, "projectId"), await readJsonBody(req)));
      return;
    }

    if (req.method === "DELETE") {
      sendJson(res, await deleteProjectPayload(param(req, "projectId")));
      return;
    }

    rejectMethod(res);
  } catch (error) {
    sendError(res, error);
  }
}
