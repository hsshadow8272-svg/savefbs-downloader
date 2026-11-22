const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const downloadsDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

function buildFormatSelector(preset) {
  switch (preset) {
    case "8k":
      return "bestvideo[height<=4320][ext=mp4]+bestaudio[ext=m4a]/best[height<=4320]/best";
    case "4k":
      return "bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/best[height<=2160]/best";
    case "2k":
      return "bestvideo[height<=1440][ext=mp4]+bestaudio[ext=m4a]/best[height<=1440]/best";
    case "1080p":
      return "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best";
    case "120fps":
      return "bestvideo[fps>=100][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best";
    case "60fps":
      return "bestvideo[fps>=50][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best";
    default:
      return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best";
  }
}

function runYtDlpWithFallback(baseArgs, url, callback) {
  const impersonateArgs = [
    ...baseArgs,
    "--impersonate",
    "chrome",
    "--user-agent",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    url,
  ];

  execFile("yt-dlp", impersonateArgs, (err, stdout, stderr) => {
    if (!err) {
      return callback(null, stdout, stderr);
    }

    const fallbackArgs = [...baseArgs, url];
    execFile("yt-dlp", fallbackArgs, (err2, stdout2, stderr2) => {
      if (!err2) {
        return callback(null, stdout2, stderr2);
      }
      const combinedErr = `${stderr || ""}\n${stderr2 || ""}`.trim() || (err2 && err2.message) || (err && err.message);
      callback(err2 || err, stdout2 || stdout, combinedErr);
    });
  });
}

app.get("/", (req, res) => {
  const publicIndex = path.join(__dirname, "public", "index.html");
  const rootIndex = path.join(__dirname, "index.html");
  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }
  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  res.status(404).send("index.html not found");
});

app.post("/api/fetch-video", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "الرابط مطلوب" });

  runYtDlpWithFallback(["-j", "--no-playlist"], url, (err, stdout, stderr) => {
    if (err) {
      console.error("yt-dlp error:", stderr || err.message);
      return res.status(500).json({
        error: "تعذر تحليل الرابط أو الفيديو خاص",
        details: (stderr || err.message || "").slice(0, 500),
      });
    }
    try {
      const info = JSON.parse(stdout);
      res.json({
        title: info.title || "video",
        thumbnail: info.thumbnail || "",
        duration: info.duration || 0,
        uploader: info.uploader || "غير معروف",
        sourceMaxQuality: info.height ? `${info.height}p` : "تلقائي",
        sourceMaxFps: info.fps ? `${info.fps}fps` : "تلقائي",
      });
    } catch {
      res.status(500).json({ error: "خطأ في قراءة بيانات الفيديو" });
    }
  });
});

app.get("/api/download", (req, res) => {
  const videoUrl = req.query.url;
  const quality = req.query.quality || "best";
  if (!videoUrl) return res.status(400).send("الرابط مطلوب");

  const fileName = `SaveFBS_${quality}_${Date.now()}.mp4`;
  const filePath = path.join(downloadsDir, fileName);
  const formatSelector = buildFormatSelector(quality);

  runYtDlpWithFallback(
    ["-f", formatSelector, "--merge-output-format", "mp4", "--no-playlist", "-o", filePath],
    videoUrl,
    (err, stdout, stderr) => {
      if (err || !fs.existsSync(filePath)) {
        console.error("yt-dlp download error:", stderr || (err && err.message));
        return res.status(500).send("فشل تحميل الفيديو بالجودة المطلوبة");
      }

      res.setHeader("Content-Type", "video/mp4");
      res.download(filePath, fileName, () => {
        fs.unlink(filePath, () => {});
      });
    }
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
