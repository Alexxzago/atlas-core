import type { RequestHandler } from "express";
import type { ChatService } from "../services/chatService.js";

export function createChatController(service: ChatService): RequestHandler {
  return async (req, res): Promise<void> => {
    const { companyId, message } = req.body ?? {};
    if (!Number.isInteger(companyId) || companyId <= 0 || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "A positive companyId and message are required." });
      return;
    }

    try {
      const result = await service.chat(companyId as number, message.trim());
      const status = result.kind === "company_not_found" ? 404 : 200;
      res.status(status).json({ answer: result.answer, status: result.kind });
    } catch (error: unknown) {
      console.error("Chat failed.", error);
      res.status(503).json({
        answer: "I'm temporarily unable to check that information. I can connect you with a human agent.",
        status: "unavailable",
      });
    }
  };
}
