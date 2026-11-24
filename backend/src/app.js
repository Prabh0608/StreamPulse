import express from "express";
import videoUploadRouter from "./modules/video.routes.js";
import streamingRouter from "./modules/streaming.routes.js";

const app = express();

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Range");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Range,Accept-Ranges,Content-Length",
  );

  if (_req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});
app.use("/api/videos", videoUploadRouter);
app.use("/api/streaming", streamingRouter);

export default app;
