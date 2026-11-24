import { Queue } from "bullmq";

const videoQueue = new Queue("video-processing", {
  connection: {
    host: "localhost",
    port: 6379,
    maxRetriesPerRequest: null,
  },
});

export default videoQueue;
