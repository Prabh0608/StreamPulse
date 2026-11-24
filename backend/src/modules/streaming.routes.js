import fs from "node:fs";
import { Router } from "express";
import Video from "./video.model.js";

const CHUNK_SIZE = 1024 * 1024;
const router = Router();

router.get("/:id", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);

    if (!video?.videoPath) {
      return res.status(404).json({ message: "Video not found" });
    }

    const fileSize = fs.statSync(video.videoPath).size;
    const range = req.headers.range;

    if (!range) {
      return res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
    }

    const [rangeStart, rangeEnd] = range.replace(/bytes=/, "").split("-");
    let start;
    let end;

    if (rangeStart === "") {
      const suffixLength = Number.parseInt(rangeEnd, 10);
      start = Math.max(fileSize - suffixLength, 0);
      end = fileSize - 1;
    } else {
      start = Number.parseInt(rangeStart, 10);
      end = rangeEnd
        ? Number.parseInt(rangeEnd, 10)
        : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
      end = Math.min(end, start + CHUNK_SIZE - 1, fileSize - 1);
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start >= fileSize ||
      end < start
    ) {
      return res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
    }

    const contentLength = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": contentLength,
      "Content-Type": "video/mp4",
    });

    return fs.createReadStream(video.videoPath, { start, end }).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ message: "Video file not found" });
    }

    return res.status(500).json({
      message: "Failed to stream video",
      error: error.message,
    });
  }
});

export default router;
