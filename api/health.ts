import { rejectMethod, sendJson, type ApiRequest, type ApiResponse } from "../src/api-support.js";

export default function handler(req: ApiRequest, res: ApiResponse): void {
  if (req.method !== "GET") {
    rejectMethod(res);
    return;
  }

  sendJson(res, { ok: true });
}
