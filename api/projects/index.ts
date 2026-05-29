import {
  createProjectPayload,
  projectsPayload,
  readJsonBody,
  rejectMethod,
  sendError,
  sendJson,
  type ApiRequest,
  type ApiResponse
} from "../../src/api-support.js";

export const maxDuration = 300;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === "GET") {
      sendJson(res, await projectsPayload());
      return;
    }

    if (req.method === "POST") {
      sendJson(res, await createProjectPayload(await readJsonBody(req)));
      return;
    }

    rejectMethod(res);
  } catch (error) {
    sendError(res, error);
  }
}
