import { Hono } from "hono";
import elections from "./routes/elections.js";
import geography from "./routes/geography.js";

const app = new Hono();

app.route("/api/elections", elections);
app.route("/api/geography", geography);

export default app;
