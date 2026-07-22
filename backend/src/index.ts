import { createApp } from "./app.js";
import { createProductionAppRouters } from "./composition.js";

const PORT = 3000;

createApp(createProductionAppRouters(), { production: process.env.NODE_ENV === "production" }).listen(PORT, () => {
  console.log(`✅ Atlas escuchando en http://localhost:${PORT}`);
});
