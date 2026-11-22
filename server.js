const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json());

const downloadsDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

// خريطة الفلاتر المطلوبة (8K, 4K, 2K, 1080p, 120fps, 60fps)
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

app.post("/api/fetch-video", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "الرابط مطلوب" });

  execFile("yt-dlp", ["-j", "--no-playlist", url], (err, stdout) => {
    if (err) {
      return res.status(500).json({ error: "تعذر تحليل الرابط أو الفيديو خاص" });
    }
    try {
      const info = JSON.parse(stdout);
      const maxHeight = info.height || 0;
      const maxFps = info.fps || 0;

      res.json({
        title: info.title || "video",
        thumbnail: info.thumbnail || "",
        duration: info.duration || 0,
        uploader: info.uploader || "غير معروف",
        sourceMaxQuality: maxHeight ? `${maxHeight}p` : "تلقائي",
        sourceMaxFps: maxFps ? `${maxFps}fps` : "تلقائي",
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

  const args = [
    "-f",
    formatSelector,
    "--merge-output-format",
    "mp4",
    "--no-playlist",
    "-o",
    filePath,
    videoUrl,
  ];

  execFile("yt-dlp", args, (err) => {
    if (err || !fs.existsSync(filePath)) {
      return res.status(500).send("فشل تحميل الفيديو بالجودة المطلوبة");
    }

    res.setHeader("Content-Type", "video/mp4");
    res.download(filePath, fileName, () => {
      fs.unlink(filePath, () => {});
    });
  });
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Server running on http://localhost:3000");
});