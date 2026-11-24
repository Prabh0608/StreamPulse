import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;
const apiUrl = (url) => (url?.startsWith("http") ? url : `${API_URL}${url}`);

const parseTimestamp = (value) => {
  const parts = value.replace(",", ".").split(":").map(Number);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
};

const parseVtt = (text) => 
  text
    .split(/\r?\n\r?\n/)
    .slice(1)
    .flatMap((block) => {
      const lines = block.trim().split(/\r?\n/);
      const timing = lines.find((line) => line.includes("-->"));
      const source = lines.find((line) => line.includes("#xywh="));
      if (!timing || !source) return [];
      const [start, end] = timing
        .split("-->")
        .map((value) => parseTimestamp(value.trim()));
      const [url, coordinates] = source.split("#xywh=");
      const [x, y, width, height] = coordinates.split(",").map(Number);
      return [{ start, end, url, x, y, width, height }];
    });
  
function UploadDropzone({ onUploaded }) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const chooseFile = (event) => setFile(event.target.files[0]);
  const dropFile = (event) => {
    event.preventDefault();
    setFile(event.dataTransfer.files[0]);
  };

  const submit = async () => {
    if (!file || !title.trim())
      return setMessage("Choose a video and enter a title.");
    setBusy(true);
    setMessage("Uploading…");
    const form = new FormData();
    form.append("video", file);
    form.append("title", title.trim());
    try {
      const response = await fetch(`${API_URL}/api/videos/upload`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Upload failed");
      setTitle("");
      setFile(null);
      setMessage("Upload queued. Processing will appear in the list.");
      onUploaded();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="upload-panel">
      <div
        className="dropzone"
        onClick={() => document.getElementById("video-file").click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFile}
      >
        <input
          id="video-file"
          type="file"
          accept="video/*"
          hidden
          onChange={chooseFile}
        />
        <span className="upload-icon">↑</span>
        <strong>
          {file ? file.name : "Drop a video here or click to browse"}
        </strong>
        <small>MP4, WebM, or another browser-supported video format</small>
      </div>
      <div className="upload-controls">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Video title"
        />
        <button onClick={submit} disabled={busy}>
          {busy ? "Uploading…" : "Upload video"}
        </button>
      </div>
      {message && <p className="message">{message}</p>}
    </section>
  );
}

function VideoPlayer({ video }) {
  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [spriteReady, setSpriteReady] = useState(false);
  const cuesRef = useRef([]);
  const durationRef = useRef(0);
  const frameRef = useRef(null);
  const pointerRef = useRef(null);
  const spriteUrl = apiUrl(video.spriteUrl);
  useEffect(() => {
    let active = true;
    cuesRef.current = [];
    setHover(null);
    if (!video.vttUrl) return undefined;
    fetch(apiUrl(video.vttUrl))
      .then((response) => response.text())
      .then((text) => {
        if (active) cuesRef.current = parseVtt(text);
      })
      .catch(() => {
        if (active) cuesRef.current = [];
      });
    return () => {
      active = false;
    };
  }, [video.vttUrl]);

  useEffect(() => {
    let active = true;
    setSpriteReady(false);
    if (!video.spriteUrl) return undefined;
    const image = new Image();
    image.onload = () => {
      if (active) setSpriteReady(true);
    };
    image.onerror = () => {
      if (active) setSpriteReady(false);
    };
    image.src = spriteUrl;
    if (image.complete && image.decode)
      image
        .decode()
        .then(() => active && setSpriteReady(true))
        .catch(() => {});
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [spriteUrl, video.spriteUrl]);
  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    },
    [],
  );
  const move = (event) => {
    pointerRef.current = event.clientX;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect || !durationRef.current || !cuesRef.current.length) return;
      const ratio = Math.max(
        0,
        Math.min(1, (pointerRef.current - rect.left) / rect.width),
      );
      const timestamp = ratio * durationRef.current;
      const cue =
        cuesRef.current.find(
          (item) => timestamp >= item.start && timestamp < item.end,
        ) || cuesRef.current[cuesRef.current.length - 1];
      setHover(cue ? { cue, left: ratio * 100, timestamp } : null);
    });
  };
  const leave = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    setHover(null);
  };
  return (
    <div className="player-wrap">
      <video
        ref={videoRef}
        controls
        src={apiUrl(video.streamUrl)}
        onLoadedMetadata={() => {
          const nextDuration = videoRef.current?.duration || 0;
          durationRef.current = nextDuration;
          setDuration(nextDuration);
        }}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
      />
      <div
        ref={timelineRef}
        className="timeline"
        onMouseMove={move}
        onMouseLeave={leave}
        onClick={(event) => {
          const rect = timelineRef.current.getBoundingClientRect();
          videoRef.current.currentTime =
            ((event.clientX - rect.left) / rect.width) * duration;
        }}
      >
        {hover && spriteReady && (
          <div className="preview" style={{ left: `${hover.left}%` }}>
            <div
              className="sprite-crop"
              style={{
                width: hover.cue.width,
                height: hover.cue.height,
                backgroundImage: `url(${spriteUrl})`,
                backgroundPosition: `-${hover.cue.x}px -${hover.cue.y}px`,
              }}
            />
            <small>{hover.timestamp.toFixed(2)}s</small>
          </div>
        )}
        <div
          className="timeline-fill"
          style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

function App() {
  const [videos, setVideos] = useState([]);
  const [selected, setSelected] = useState(null);
  const loadVideos = useCallback(
    () =>
      fetch(`${API_URL}/api/videos`)
        .then((response) => response.json())
        .then(setVideos)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    loadVideos();
    const timer = setInterval(loadVideos, 3000);
    return () => clearInterval(timer);
  }, [loadVideos]);
  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">STREAM PULSE</span>
          <h1>Video library</h1>
        </div>
        {selected && (
          <button className="back" onClick={() => setSelected(null)}>
            ← Back to library
          </button>
        )}
      </header>
      {selected ? (
        <section className="watch">
          <span className="eyebrow">WATCHING</span>
          <h2>{selected.title}</h2>
          <VideoPlayer video={selected} />
        </section>
      ) : (
        <>
          <UploadDropzone onUploaded={loadVideos} />
          <section className="library">
            <div className="section-heading">
              <h2>Your videos</h2>
              <span>{videos.length} total</span>
            </div>
            <div className="grid">
              {videos.map((video) => (
                <button
                  className="video-card"
                  key={video.id}
                  onClick={() => video.status === "ready" && setSelected(video)}
                  disabled={video.status !== "ready"}
                >
                  <div className="card-art">
                    {video.spriteUrl ? (
                      <img src={apiUrl(video.spriteUrl)} alt="" />
                    ) : (
                      <span>{video.status}</span>
                    )}
                  </div>
                  <div>
                    <strong>{video.title}</strong>
                    <small>{video.status}</small>
                  </div>
                </button>
              ))}
            </div>
            {!videos.length && (
              <p className="empty">Upload your first video to get started.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default App;
