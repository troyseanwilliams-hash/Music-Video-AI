import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import storageRouter from "./storage.js";
import jobsRouter from "./jobs.js";
import videosRouter from "./videos.js";
import creditsRouter from "./credits.js";
import dashboardRouter from "./dashboard.js";
import billingRouter from "./billing.js";
import sunoRouter from "./suno.js";
import supportRouter from "./support.js";
import adminJobsRouter from "./admin-jobs.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(jobsRouter);
router.use(videosRouter);
router.use(creditsRouter);
router.use(dashboardRouter);
router.use(billingRouter);
router.use(sunoRouter);
router.use(supportRouter);
router.use(adminJobsRouter);

export default router;
