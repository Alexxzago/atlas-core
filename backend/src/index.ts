import { createApp } from "./app.js";
import { createProductionAppRouters } from "./composition.js";

const portValue = Number(process.env.PORT ?? "3000");
if (!Number.isSafeInteger(portValue) || portValue < 1 || portValue > 65_535) throw new Error("PORT must be a valid TCP port.");

createApp(createProductionAppRouters(), { production: process.env.NODE_ENV === "production" }).listen(portValue, "0.0.0.0", () => {
  console.log(`Atlas listening on port ${portValue}`);
});
