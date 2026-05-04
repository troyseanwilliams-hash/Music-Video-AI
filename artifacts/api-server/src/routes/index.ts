import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import jobsRouter from "./jobs";
import videosRouter from "./videos";
import creditsRouter from "./credits";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(jobsRouter);
router.use(videosRouter);
router.use(creditsRouter);
router.use(dashboardRouter);

export default router;
