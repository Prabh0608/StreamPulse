import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { Router } from "express";
import Video from "./video.model.js";
import videoQueue from "../config/video.queue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDirectory = path.resolve(__dirname, "../../temp");

fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDirectory);
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, extension);
    const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, "-");
    callback(null, `${Date.now()}-${safeBaseName}${extension}`);
  },
});

const upload = multer({ storage });
const router = Router();

router.get("/", async (_req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 }).lean();
    return res.json(
      videos.map((video) => ({
        id: video._id,
        title: video.title,
        originalFileName: video.originalFileName,
        status: video.status,
        createdAt: video.createdAt,
        streamUrl: `/api/streaming/${video._id}`,
        spriteUrl: video.spriteSheetPath
          ? `/api/videos/${video._id}/sprite`
          : null,
        vttUrl: video.vttPath ? `/api/videos/${video._id}/vtt` : null,
      })),
    );
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Failed to fetch videos", error: error.message });
  }
});

const sendAsset = async (assetPath, contentType, res) => {
  try {
    await fs.promises.access(assetPath);
    res.type(contentType);
    return fs.createReadStream(assetPath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ message: "Asset not found" });
    }

    return res
      .status(500)
      .json({ message: "Failed to read asset", error: error.message });
  }
};

router.get("/:id/sprite", async (req, res) => {
  const video = await Video.findById(req.params.id).lean();
  if (!video?.spriteSheetPath)
    return res.status(404).json({ message: "Sprite not found" });
  return sendAsset(video.spriteSheetPath, "image/jpeg", res);
});

router.get("/:id/vtt", async (req, res) => {
  const video = await Video.findById(req.params.id).lean();
  if (!video?.vttPath)
    return res.status(404).json({ message: "VTT not found" });
  return sendAsset(video.vttPath, "text/vtt", res);
});

router.post("/upload", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "A video file is required" });
  }

  if (!req.body.title) {
    return res.status(400).json({ message: "A title is required" });
  }

  try {
    const video = await Video.create({
      title: req.body.title,
      originalFileName: req.file.originalname,
      videoPath: req.file.path,
      status: "pending",
    });

    await videoQueue.add("process-video", {
      videoId: video.id,
      filePath: req.file.path,
    });

    return res.status(202).json({
      message: "Video upload accepted for processing",
      videoId: video.id,
      status: video.status,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to queue video for processing",
      error: error.message,
    });
  }
});

export default router;
