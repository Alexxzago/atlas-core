import express from "express";

const app = express();

const PORT = 3000;

app.get("/", (req, res) => {
  res.send("🚀 Atlas Core está funcionando.");
});

app.listen(PORT, () => {
  console.log(`✅ Atlas escuchando en http://localhost:${PORT}`);
});