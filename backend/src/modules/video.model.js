import { Schema, model } from "mongoose";

const videoSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    originalFileName: {
      type: String,
      required: true,
      trim: true,
    },
    videoPath: {
      type: String,
      required: true,
      trim: true,
    },
    spriteSheetPath: {
      type: String,
      trim: true,
    },
    vttPath: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "ready", "failed"],
      default: "pending",
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  },
);

export default model("Video", videoSchema);
