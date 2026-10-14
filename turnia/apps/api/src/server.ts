import { app } from "./app.js";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const port = Number(process.env.API_PORT) || 3000;

app.listen(port, () => {
  console.log(`Turnia API escuchando en http://localhost:${port}`);
});
