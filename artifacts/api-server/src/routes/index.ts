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
import adminVideosRouter from "./admin-videos.js";
import audioRouter from "./audio.js";
import studioRouter from "./studio.js";
import referralsRouter from "./referrals.js";
import teasersRouter from "./teasers.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(audioRouter);
router.use(jobsRouter);
router.use(videosRouter);
router.use(creditsRouter);
router.use(dashboardRouter);
router.use(billingRouter);
router.use(sunoRouter);
router.use(supportRouter);
router.use(adminJobsRouter);
router.use(adminVideosRouter);
router.use(studioRouter);
router.use(referralsRouter);
router.use(teasersRouter);

export default router;
