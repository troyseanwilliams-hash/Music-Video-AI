import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import router from "./routes/index.js";
import { csrfOriginGuard, isAllowedOrigin } from "./lib/originPolicy.js";
import { parseTrustProxy } from "./lib/trustProxy.js";
import { logger } from "./lib/logger.js";
import { authMiddleware } from "./middlewares/authMiddleware.js";
import {
  isInvalidStripeSignatureError,
  WebhookHandlers,
} from "./lib/webhookHandlers.js";

const app: Express = express();

// Behind Replit's proxy chain. Trust only private-network hops (override with
// TRUST_PROXY_HOPS) rather than `true`, which would accept a client-forged leftmost
// X-Forwarded-For value and defeat the per-IP signup/login limits.
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY_HOPS));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: { id: unknown; method: string; url?: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: { statusCode: number }) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Credentialed CORS only for our own origins (never reflect arbitrary origins
// while cookies are accepted). Requests with no Origin header are unaffected.
app.use(
  cors((req, callback) => {
    callback(null, {
      credentials: true,
      origin: isAllowedOrigin(req.headers.origin, req.headers.host),
    });
  }),
);

// Stripe webhook MUST be registered BEFORE express.json() so it gets the raw Buffer.
app.post(
  "/api/stripe/suite-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      await WebhookHandlers.processSuiteWebhook(req.body, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err }, "Suite Stripe webhook processing error");
      res
        .status(isInvalidStripeSignatureError(err) ? 400 : 500)
        .json({ error: "Webhook processing error" });
    }
  },
);

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;

    try {
      if (!Buffer.isBuffer(req.body)) {
        logger.error(
          "Stripe webhook: req.body is not a Buffer (express.json ran first?)",
        );
        res.status(500).json({ error: "Webhook misconfigured" });
        return;
      }
      await WebhookHandlers.processWebhook(req.body, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err }, "Stripe webhook processing error");
      res
        .status(isInvalidStripeSignatureError(err) ? 400 : 500)
        .json({ error: "Webhook processing error" });
    }
  },
);

// CSRF defence: reject state-changing requests sent from untrusted origins.
// Stripe webhooks (above) carry no Origin and are signature-verified instead.
app.use(csrfOriginGuard);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

export default app;
