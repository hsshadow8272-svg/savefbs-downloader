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
  fs.mkdirSync(downloadsDir, { recursive: true });
}

function buildFormatSelector(preset) {
  switch (preset) {
    case "8k":
      return "bestvideo[height<=4320]+bestaudio/best[height<=4320]/best";
    case "4k":
      return "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best";
    case "2k":
      return "bestvideo[height<=1440]+bestaudio/best[height<=1440]/best";
    case "1080p":
      return "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best";
    case "120fps":
      return "bestvideo[fps>=100]+bestaudio/bestvideo[fps>=60]+bestaudio/bestvideo+bestaudio/best";
    case "60fps":
      return "bestvideo[fps>=50]+bestaudio/bestvideo[fps>=30]+bestaudio/bestvideo+bestaudio/best";
    default:
      return "bestvideo+bestaudio/best";
  }
}

function buildFfmpegFilters(quality) {
  const filters = [];

  if (quality === "8k") {
    filters.push("scale=7680:4320:force_original_aspect_ratio=decrease,pad=7680:4320:(ow-iw)/2:(oh-ih)/2");
  } else if (quality === "4k") {
    filters.push("scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2");
  } else if (quality === "2k") {
    filters.push("scale=2560:1440:force_original_aspect_ratio=decrease,pad=2560:1440:(ow-iw)/2:(oh-ih)/2");
  }

  if (quality === "120fps") {
    filters.push("minterpolate=fps=120:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1");
  } else if (quality === "60fps") {
    filters.push("fps=60");
  }

  return filters;
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
      const combinedErr =
        `${stderr || ""}\n${stderr2 || ""}`.trim() ||
        (err2 && err2.message) ||
        (err && err.message);
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

  const stamp = Date.now();
  const rawFilePath = path.join(downloadsDir, `raw_${quality}_${stamp}.mp4`);
  const finalFileName = `SaveFBS_${quality}_${stamp}.mp4`;
  const finalFilePath = path.join(downloadsDir, finalFileName);
  const formatSelector = buildFormatSelector(quality);
  const vfFilters = buildFfmpegFilters(quality);

  runYtDlpWithFallback(
    ["-f", formatSelector, "--merge-output-format", "mp4", "--no-playlist", "-o", rawFilePath],
    videoUrl,
    (err, stdout, stderr) => {
      if (err || !fs.existsSync(rawFilePath)) {
        console.error("yt-dlp download error:", stderr || (err && err.message));
        return res.status(500).send("فشل تحميل الفيديو بالجودة المطلوبة");
      }

      if (vfFilters.length === 0) {
        res.setHeader("Content-Type", "video/mp4");
        return res.download(rawFilePath, finalFileName, () => {
          fs.unlink(rawFilePath, () => {});
        });
      }

      const ffmpegArgs = [
        "-y",
        "-i",
        rawFilePath,
        "-vf",
        vfFilters.join(","),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        finalFilePath,
      ];

      execFile("ffmpeg", ffmpegArgs, (ffErr, ffStdout, ffStderr) => {
        fs.unlink(rawFilePath, () => {});
        if (ffErr || !fs.existsSync(finalFilePath)) {
          console.error("ffmpeg processing error:", ffStderr || (ffErr && ffErr.message));
          return res.status(500).send("فشل معالجة الفيديو بالدقة أو الفريمات المطلوبة");
        }

        res.setHeader("Content-Type", "video/mp4");
        res.download(finalFilePath, finalFileName, () => {
          fs.unlink(finalFilePath, () => {});
        });
      });
    }
  );
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
