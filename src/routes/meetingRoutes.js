import { Router } from "express";
import {
  createMeeting,
  getMeetingDetails,
  getMyMeetings,
  joinMeetingLookup,
  markMeetingEnded
} from "../controllers/meetingController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

router.use(requireAuth);
router.get("/", getMyMeetings);
router.post("/", createMeeting);
router.post("/join", joinMeetingLookup);
router.get("/:identifier", getMeetingDetails);
router.patch("/:identifier/end", markMeetingEnded);

export default router;
