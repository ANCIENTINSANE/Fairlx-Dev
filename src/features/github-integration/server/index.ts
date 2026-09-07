import { Hono } from "hono";
import repository from "./route";
import documentation from "./documentation-route";
import oauth from "./oauth-route";
import account from "./account-route";
import webhooks from "./webhook-route";

const app = new Hono()
  .route("/repository", repository)
  .route("/documentation", documentation)
  .route("/oauth", oauth)
  .route("/account", account)
  .route("/webhooks", webhooks);

export default app;

