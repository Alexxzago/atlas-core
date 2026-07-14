import type { RequestHandler } from "express";
import type { CompanyService } from "../services/companyService.js";

export function createListCompaniesController(service: CompanyService): RequestHandler {
  return (_req, res): void => { res.json(service.list()); };
}

export function createCompanyController(service: CompanyService): RequestHandler {
  return (req, res): void => {
    const { name, website, phone, email } = req.body ?? {};
    if (typeof name !== "string" || !name.trim() || typeof website !== "string" || !website.trim()) {
      res.status(400).json({ error: "Name and website are required." });
      return;
    }
    try {
      const input: { name: string; website: string; phone?: string; email?: string } = {
        name: name.trim(),
        website: website.trim(),
      };
      if (typeof phone === "string") input.phone = phone;
      if (typeof email === "string") input.email = email;
      res.status(201).json(service.create(input));
    } catch (error: unknown) {
      console.error("Company creation failed.", error);
      res.status(500).json({ error: "Could not create company." });
    }
  };
}
