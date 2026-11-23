const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const LUATOLLS_PASSWORD = process.env.LUATOLLS_ACCESS_PASSWORD || "4KL2026";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

function sendHtmlFile(res, filename) {
  const inPublic = path.join(__dirname, "public", filename);
  const inRoot = path.join(__dirname, filename);
  if (fs.existsSync(inPublic)) return res.sendFile(inPublic);
  if (fs.existsSync(inRoot)) return res.sendFile(inRoot);
  return res.status(404).send(`${filename} not found`);
}

app.get("/", (req, res) => {
  sendHtmlFile(res, "index.html");
});

app.get("/fps-booster", (req, res) => {
  sendHtmlFile(res, "fps-booster.html");
});

app.get("/steam-games", (req, res) => {
  sendHtmlFile(res, "steam-games.html");
});

app.get("/luatolls-games", (req, res) => {
  sendHtmlFile(res, "luatolls-games.html");
});

app.post("/api/luatolls/unlock", (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password) !== String(LUATOLLS_PASSWORD)) {
    return res.status(401).json({ ok: false, error: "كلمة المرور غير صحيحة" });
  }
  return res.json({ ok: true, message: "تم فتح مكتبة LuaTolls بنجاح" });
});

function isSafeOriginalUrl(urlStr) {
  if (typeof urlStr !== "string" || !urlStr.trim()) return false;
  try {
    const parsed = new URL(urlStr.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeGameItem(raw, index = 0) {
  const originalDownloadUrl = isSafeOriginalUrl(
    raw.downloadUrl || raw.download_url || raw.url
  )
    ? String(raw.downloadUrl || raw.download_url || raw.url).trim()
    : "";

  const coverUrl = isSafeOriginalUrl(
    raw.cover || raw.coverUrl || raw.image || raw.thumbnail
  )
    ? String(raw.cover || raw.coverUrl || raw.image || raw.thumbnail).trim()
    : "";

  return {
    id: String(raw.id ?? raw.slug ?? index + 1),
    title: String(raw.title || raw.name || "لعبة").trim(),
    description: String(raw.description || raw.desc || "لا يوجد وصف متاح.").trim(),
    cover: coverUrl,
    size: String(raw.size || raw.fileSize || "غير محدد").trim(),
    version: String(raw.version || raw.ver || "1.0").trim(),
    category: String(raw.category || raw.genre || "عام").trim(),
    downloads: Number(raw.downloads ?? raw.downloadCount ?? 0) || 0,
    updatedAt: String(
      raw.updatedAt || raw.releaseDate || raw.date || "2026-11-23"
    ).trim(),
    downloadUrl: originalDownloadUrl
  };
}

app.get("/api/luatolls/games", async (req, res) => {
  const feedUrl = (process.env.LUATOLLS_FEED_URL || "").trim();
  const localFile = path.join(__dirname, "data", "luatolls-games.json");

  try {
    if (feedUrl && isSafeOriginalUrl(feedUrl)) {
      const headers = { Accept: "application/json" };
      if (process.env.LUATOLLS_API_KEY) {
        headers.Authorization = `Bearer ${process.env.LUATOLLS_API_KEY}`;
      }

      const response = await fetch(feedUrl, { headers });
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }

      const payload = await response.json();
      const rawList = Array.isArray(payload)
        ? payload
        : payload.games || payload.data || payload.items || [];

      return res.json({
        updatedAt: new Date().toISOString(),
        games: rawList.map((item, idx) => normalizeGameItem(item, idx))
      });
    }

    if (fs.existsSync(localFile)) {
      const content = JSON.parse(fs.readFileSync(localFile, "utf8"));
      const rawList = Array.isArray(content) ? content : content.games || [];
      return res.json({
        updatedAt: fs.statSync(localFile).mtime.toISOString(),
        games: rawList.map((item, idx) => normalizeGameItem(item, idx))
      });
    }

    return res.json({ updatedAt: new Date().toISOString(), games: [] });
  } catch (err) {
    return res
      .status(502)
      .json({ error: "تعذر جلب قائمة الألعاب حالياً", details: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
