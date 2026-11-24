import "dotenv/config";

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { Worker } from "bullmq";
import Video from "../modules/video.model.js";


const MAX_SPRITE_COLUMNS = 10;
const MAX_SPRITE_ROWS = 10;
const MAX_SPRITE_THUMBNAILS = MAX_SPRITE_COLUMNS * MAX_SPRITE_ROWS;
const THUMBNAIL_WIDTH = 320;

const runProcess = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args);

    child.stderr.on("data", (data) => {
      console.log(`[${command}] ${data.toString().trim()}`);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });

const getVideoMetadata = (filePath) =>
  new Promise((resolve, reject) => {
    const child = spawn(ffprobeStatic.path, [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=width,height",
      "-select_streams",
      "v:0",
      "-of",
      "json",
      filePath,
    ]);

    let output = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}`));
        return;
      }

      let metadata;
      try {
        metadata = JSON.parse(output);
      } catch {
        reject(new Error("Unable to parse video metadata"));
        return;
      }

      const duration = Number.parseFloat(metadata.format?.duration);
      const width = Number(metadata.streams?.[0]?.width);
      const height = Number(metadata.streams?.[0]?.height);

      if (
        ![duration, width, height].every(Number.isFinite) ||
        width <= 0 ||
        height <= 0
      ) {
        reject(new Error("Unable to determine video metadata"));
        return;
      }

      resolve({ duration, sourceWidth: width, sourceHeight: height });
    });
  });

const formatTimestamp = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = (seconds % 60).toFixed(3).padStart(6, "0");

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${remainingSeconds}`;
};

const getSpriteConfig = (duration, sourceWidth, sourceHeight) => {
  const baseInterval = duration <= 90 ? 2 : duration <= 600 ? 5 : 10;
  const interval = Math.max(
    baseInterval,
    Math.ceil(duration / MAX_SPRITE_THUMBNAILS),
  );
  const thumbnailCount = Math.min(
    MAX_SPRITE_THUMBNAILS,
    Math.ceil(duration / interval),
  );
  const columns = Math.min(
    MAX_SPRITE_COLUMNS,
    Math.max(1, Math.ceil(Math.sqrt(thumbnailCount))),
  );
  const rows = Math.min(
    MAX_SPRITE_ROWS,
    Math.max(1, Math.ceil(thumbnailCount / columns)),
  );
  const thumbnailHeight = Math.max(
    2,
    Math.ceil(((sourceHeight / sourceWidth) * THUMBNAIL_WIDTH) / 2) * 2,
  );

  return {
    interval,
    columns,
    rows,
    thumbnailCount,
    thumbnailWidth: THUMBNAIL_WIDTH,
    thumbnailHeight,
  };
};

const createVtt = (spriteFileName, duration, config) => {
  const lines = ["WEBVTT", ""];

  for (let index = 0; index < config.thumbnailCount; index += 1) {
    const start = index * config.interval;
    const end = Math.min(start + config.interval, duration);
    const column = index % config.columns;
    const row = Math.floor(index / config.columns);
    const x = column * config.thumbnailWidth;
    const y = row * config.thumbnailHeight;

    lines.push(
      `${formatTimestamp(start)} --> ${formatTimestamp(end)}`,
      `${spriteFileName}#xywh=${x},${y},${config.thumbnailWidth},${config.thumbnailHeight}`,
      "",
    );
  }

  return lines.join("\n");
};

new Worker(
  "video-processing",
  async (job) => {
    const { videoId } = job.data;
    const inputPath = job.data.filePath;
    const outputDirectory = path.dirname(inputPath);
    const outputPath = path.join(outputDirectory, `${videoId}.mp4`);
    const spritePath = path.join(outputDirectory, `${videoId}-sprite.jpg`);
    const vttPath = path.join(outputDirectory, `${videoId}.vtt`);
    const spriteFileName = path.basename(spritePath);

    try {
      await Video.findOneAndUpdate(
        { _id: videoId, status: "pending" },
        { $set: { status: "processing" } },
      );

      await runProcess(ffmpegPath, [
        "-y",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputPath,
      ]);

      const { duration, sourceWidth, sourceHeight } =
        await getVideoMetadata(outputPath);
      const spriteConfig = getSpriteConfig(duration, sourceWidth, sourceHeight);

      await runProcess(ffmpegPath, [
        "-y",
        "-i",
        outputPath,
        "-vf",
        `fps=1/${spriteConfig.interval},scale=${spriteConfig.thumbnailWidth}:${spriteConfig.thumbnailHeight},tile=${spriteConfig.columns}x${spriteConfig.rows}`,
        "-frames:v",
        "1",
        spritePath,
      ]);
      await fs.writeFile(
        vttPath,
        createVtt(spriteFileName, duration, spriteConfig),
      );

      await Video.findByIdAndUpdate(videoId, {
        videoPath: outputPath,
        spriteSheetPath: spritePath,
        vttPath,
        status: "ready",
      });
    } catch (error) {
      await Video.findByIdAndUpdate(videoId, { status: "failed" });
      throw error;
    } finally {
      try {
        await fs.unlink(inputPath);
        console.log(`Deleted temporary input file: ${inputPath}`);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.error(`Failed to delete input file ${inputPath}:`, error);
        }
      }
    }
  },
  {
    connection: {
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    },
  },
);
