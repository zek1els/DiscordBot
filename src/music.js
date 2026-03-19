import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
} from "@discordjs/voice";
import play from "play-dl";
import { spawn } from "child_process";
import { createRequire } from "module";

let ffmpegStatic = null;
try {
  const require = createRequire(import.meta.url);
  ffmpegStatic = require("ffmpeg-static");
} catch {
  // ffmpeg-static not installed – fall back to system ffmpeg
}

const FFMPEG = ffmpegStatic || "ffmpeg";

/** @type {Map<string, MusicQueue>} */
const queues = new Map();
let spotifyReady = false;
let spotifyToken = null;
let spotifyTokenExpiry = 0;

/* ------------------------------------------------------------------ */
/*  yt-dlp helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Run yt-dlp with given args and return stdout as a string.
 */
function ytdlp(args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`yt-dlp timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `yt-dlp exited with code ${code}`));
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Get the direct audio stream URL for a YouTube video using yt-dlp.
 */
async function getAudioUrl(videoUrl) {
  return ytdlp([
    "-f", "bestaudio[ext=webm]/bestaudio",
    "-g",             // print URL only
    "--no-playlist",
    "--no-warnings",
    videoUrl,
  ]);
}

/**
 * Get video metadata (title, duration, thumbnail) using yt-dlp.
 */
async function getVideoInfo(videoUrl) {
  const json = await ytdlp([
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    videoUrl,
  ]);
  const data = JSON.parse(json);
  return {
    url: data.webpage_url || data.original_url || videoUrl,
    title: data.title || "Unknown",
    duration: formatDuration(data.duration || 0),
    thumbnail: data.thumbnail || null,
  };
}

/* ------------------------------------------------------------------ */
/*  Spotify helpers (client credentials flow)                          */
/* ------------------------------------------------------------------ */

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  const data = await res.json();
  spotifyToken = data.access_token;
  spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return spotifyToken;
}

async function spotifyGetTrack(trackId) {
  const token = await getSpotifyToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const t = await res.json();
  return { name: t.name, artists: t.artists?.map((a) => a.name) || [] };
}

async function spotifyGetTracks(type, id) {
  const token = await getSpotifyToken();
  const endpoint = type === "playlist"
    ? `https://api.spotify.com/v1/playlists/${id}/tracks?limit=50`
    : `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`;
  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map((item) => {
    const t = type === "playlist" ? item.track : item;
    return t ? { name: t.name, artists: t.artists?.map((a) => a.name) || [] } : null;
  }).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

export async function initMusic() {
  // Verify yt-dlp is available
  try {
    const ver = await ytdlp(["--version"], 5_000);
    console.log(`Music: yt-dlp ${ver} found.`);
  } catch (e) {
    console.warn("Music: yt-dlp not found — music commands will not work.", e.message);
  }

  const spotifyId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const spotifySecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (spotifyId && spotifySecret) {
    try {
      await getSpotifyToken();
      spotifyReady = true;
      console.log("Spotify support enabled for music playback.");
    } catch (e) {
      console.warn("Spotify token setup failed:", e.message);
    }
  } else {
    console.log("Music: Spotify credentials not set — YouTube/SoundCloud only.");
  }
}

export function getQueue(guildId) {
  return queues.get(guildId) || null;
}

/* ------------------------------------------------------------------ */
/*  MusicQueue                                                         */
/* ------------------------------------------------------------------ */

export class MusicQueue {
  constructor(guildId, voiceChannel, textChannel) {
    this.guildId = guildId;
    this.textChannel = textChannel;
    this.songs = [];
    this.current = null;
    this.volume = 50;
    this.loop = "off"; // off | song | queue
    this.playing = false;
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    this.connection.subscribe(this.player);
    this._setupListeners();
    queues.set(guildId, this);
  }

  _setupListeners() {
    this.player.on(AudioPlayerStatus.Idle, () => this._onIdle());
    this.player.on("error", (err) => {
      console.error("Audio player error:", err.message);
      this._onIdle();
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });
  }

  _onIdle() {
    if (this.loop === "song" && this.current) {
      this.songs.unshift(this.current);
    } else if (this.loop === "queue" && this.current) {
      this.songs.push(this.current);
    }
    this.current = null;
    this.playing = false;
    if (this.songs.length > 0) {
      this.processQueue();
    } else {
      this._autoLeaveTimeout = setTimeout(() => {
        if (!this.playing && this.songs.length === 0) {
          this.textChannel.send({ embeds: [{ color: 0x99aab5, description: "⏹️ Queue empty — leaving voice channel." }] }).catch(() => {});
          this.destroy();
        }
      }, 120_000);
    }
  }

  async processQueue() {
    if (this._autoLeaveTimeout) clearTimeout(this._autoLeaveTimeout);
    if (this.songs.length === 0) { this.playing = false; return; }
    const song = this.songs.shift();
    this.current = song;
    try {
      // Pipe yt-dlp → ffmpeg → discord (high-quality Opus passthrough)
      const ytdlpProc = spawn("yt-dlp", [
        "-f", "bestaudio",
        "-o", "-",
        "--no-playlist",
        "--no-warnings",
        song.url,
      ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

      const vol = this.volume / 100;
      const ffmpeg = spawn(FFMPEG, [
        "-i", "pipe:0",
        "-af", `volume=${vol}`,
        "-c:a", "libopus",
        "-b:a", "128k",
        "-ar", "48000",
        "-ac", "2",
        "-f", "ogg",
        "-loglevel", "error",
        "pipe:1",
      ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

      // Pipe yt-dlp stdout → ffmpeg stdin
      ytdlpProc.stdout.pipe(ffmpeg.stdin);

      ytdlpProc.stderr.on("data", (d) => {
        const msg = d.toString().trim();
        if (msg) console.error("yt-dlp stderr:", msg);
      });

      ytdlpProc.on("error", (err) => {
        console.error("yt-dlp process error:", err.message);
      });

      ffmpeg.stderr.on("data", (d) => {
        const msg = d.toString().trim();
        if (msg) console.error("ffmpeg stderr:", msg);
      });

      ffmpeg.on("error", (err) => {
        console.error("ffmpeg process error:", err.message);
        this.textChannel.send({ embeds: [{ color: 0xed4245, description: `❌ Playback error for **${song.title}**: ${err.message}` }] }).catch(() => {});
        this.current = null;
        this.playing = false;
        this.processQueue();
      });

      // Clean up both processes when one ends
      ytdlpProc.on("close", () => { try { ffmpeg.stdin.end(); } catch {} });
      ffmpeg.on("close", () => { try { ytdlpProc.kill(); } catch {} });

      const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.OggOpus,
      });
      this.player.play(resource);
      this.playing = true;
    } catch (e) {
      console.error("Failed to stream:", song.url, e.message);
      this.textChannel.send({ embeds: [{ color: 0xed4245, description: `❌ Failed to play **${song.title}**: ${e.message}` }] }).catch(() => {});
      this.current = null;
      this.processQueue();
    }
  }

  enqueue(song) {
    this.songs.push(song);
    if (!this.playing && !this.current) this.processQueue();
  }

  skip() {
    this.player.stop(true);
  }

  pause() {
    this.player.pause();
  }

  resume() {
    this.player.unpause();
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(150, vol));
  }

  shuffle() {
    for (let i = this.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
    }
  }

  remove(index) {
    if (index < 0 || index >= this.songs.length) return null;
    return this.songs.splice(index, 1)[0];
  }

  destroy() {
    if (this._autoLeaveTimeout) clearTimeout(this._autoLeaveTimeout);
    this.songs = [];
    this.current = null;
    this.playing = false;
    try { this.player.stop(true); } catch {}
    try { this.connection.destroy(); } catch {}
    queues.delete(this.guildId);
  }
}

/* ------------------------------------------------------------------ */
/*  Song resolution                                                    */
/* ------------------------------------------------------------------ */

/**
 * Search/resolve a song from a URL or search query.
 * @param {string} query - URL or search terms
 * @returns {Promise<Object|Object[]|null>}
 */
export async function resolveSong(query) {
  query = query.trim();
  const urlType = await play.validate(query);

  // Direct YouTube URL — use yt-dlp for metadata
  if (urlType === "yt_video") {
    return getVideoInfo(query);
  }

  // YouTube playlist — use yt-dlp to enumerate
  if (urlType === "yt_playlist") {
    try {
      const raw = await ytdlp([
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        query,
      ]);
      const entries = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      return entries.slice(0, 100).map((e) => ({
        url: e.url?.startsWith("http") ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title || "Unknown",
        duration: formatDuration(e.duration || 0),
        thumbnail: e.thumbnails?.[0]?.url || null,
      }));
    } catch {
      return null;
    }
  }

  // Spotify track
  if (urlType === "sp_track") {
    if (!spotifyReady) return null;
    const trackId = query.match(/track\/([a-zA-Z0-9]+)/)?.[1];
    if (!trackId) return null;
    const sp = await spotifyGetTrack(trackId);
    if (!sp) return null;
    // Search YouTube via yt-dlp
    return searchYouTube(`${sp.name} ${sp.artists[0] || ""}`);
  }

  // Spotify playlist/album
  if (urlType === "sp_playlist" || urlType === "sp_album") {
    if (!spotifyReady) return null;
    const isPlaylist = urlType === "sp_playlist";
    const id = query.match(new RegExp(`${isPlaylist ? "playlist" : "album"}\\/([a-zA-Z0-9]+)`))?.[1];
    if (!id) return null;
    const tracks = await spotifyGetTracks(isPlaylist ? "playlist" : "album", id);
    const results = [];
    for (const track of tracks.slice(0, 50)) {
      try {
        const song = await searchYouTube(`${track.name} ${track.artists[0] || ""}`);
        if (song) {
          song.title = `${track.name} — ${track.artists.join(", ") || "Unknown"}`;
          results.push(song);
        }
      } catch {}
    }
    return results.length > 0 ? results : null;
  }

  // SoundCloud — yt-dlp supports it natively
  if (urlType === "so_track") {
    return getVideoInfo(query);
  }

  // Text search — use yt-dlp ytsearch
  return searchYouTube(query);
}

/**
 * Search YouTube for a single result using yt-dlp.
 */
async function searchYouTube(query) {
  try {
    const json = await ytdlp([
      `ytsearch1:${query}`,
      "--dump-json",
      "--no-playlist",
      "--no-warnings",
      "--default-search", "ytsearch",
    ], 15_000);
    const data = JSON.parse(json);
    return {
      url: data.webpage_url || `https://www.youtube.com/watch?v=${data.id}`,
      title: data.title || "Unknown",
      duration: formatDuration(data.duration || 0),
      thumbnail: data.thumbnail || null,
    };
  } catch (e) {
    console.error("yt-dlp search failed:", e.message);
    return null;
  }
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
