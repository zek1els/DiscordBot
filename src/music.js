import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
} from "@discordjs/voice";
import play from "play-dl";
import ytdl from "@distube/ytdl-core";

/** @type {Map<string, MusicQueue>} */
const queues = new Map();
let spotifyReady = false;
let spotifyToken = null;
let spotifyTokenExpiry = 0;

/**
 * Get a Spotify access token using the client credentials flow.
 */
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

/**
 * Fetch track info from Spotify Web API.
 */
async function spotifyGetTrack(trackId) {
  const token = await getSpotifyToken();
  const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const t = await res.json();
  return { name: t.name, artists: t.artists?.map((a) => a.name) || [] };
}

/**
 * Fetch playlist/album tracks from Spotify Web API.
 */
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

/**
 * Initialise Spotify support if credentials are available.
 */
export async function initMusic() {
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
      const stream = ytdl(song.url, {
        filter: "audioonly",
        quality: "highestaudio",
        highWaterMark: 1 << 25,
      });
      const resource = createAudioResource(stream, {
        inlineVolume: true,
      });
      resource.volume?.setVolume(this.volume / 100);
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
    // Volume applies to next song; current resource volume can be adjusted if available
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

/**
 * Search/resolve a song from a URL or search query.
 * @param {string} query - URL or search terms
 * @returns {Promise<{url: string, title: string, duration: string, thumbnail?: string} | null>}
 */
export async function resolveSong(query) {
  query = query.trim();
  const urlType = await play.validate(query);

  // Direct YouTube URL
  if (urlType === "yt_video") {
    const info = await ytdl.getBasicInfo(query);
    const d = info.videoDetails;
    const secs = parseInt(d.lengthSeconds, 10) || 0;
    return {
      url: d.video_url,
      title: d.title || "Unknown",
      duration: formatDuration(secs),
      thumbnail: d.thumbnails?.[d.thumbnails.length - 1]?.url,
    };
  }

  // YouTube playlist
  if (urlType === "yt_playlist") {
    const playlist = await play.playlist_info(query, { incomplete: true });
    const videos = await playlist.all_videos();
    return videos.map((v) => ({
      url: v.url,
      title: v.title || "Unknown",
      duration: v.durationRaw || "?",
      thumbnail: v.thumbnails?.[0]?.url,
    }));
  }

  // Spotify track
  if (urlType === "sp_track") {
    if (!spotifyReady) return null;
    const trackId = query.match(/track\/([a-zA-Z0-9]+)/)?.[1];
    if (!trackId) return null;
    const sp = await spotifyGetTrack(trackId);
    if (!sp) return null;
    const searched = await play.search(`${sp.name} ${sp.artists[0] || ""}`, { limit: 1 });
    if (searched.length === 0) return null;
    return {
      url: searched[0].url,
      title: `${sp.name} — ${sp.artists.join(", ") || "Unknown"}`,
      duration: searched[0].durationRaw || "?",
      thumbnail: searched[0].thumbnails?.[0]?.url,
    };
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
        const searched = await play.search(`${track.name} ${track.artists[0] || ""}`, { limit: 1 });
        if (searched.length > 0) {
          results.push({
            url: searched[0].url,
            title: `${track.name} — ${track.artists.join(", ") || "Unknown"}`,
            duration: searched[0].durationRaw || "?",
            thumbnail: searched[0].thumbnails?.[0]?.url,
          });
        }
      } catch {}
    }
    return results.length > 0 ? results : null;
  }

  // SoundCloud
  if (urlType === "so_track") {
    const info = await play.soundcloud(query);
    return {
      url: info.url,
      title: info.name || "Unknown",
      duration: info.durationInSec ? formatDuration(info.durationInSec) : "?",
      thumbnail: info.thumbnail,
    };
  }

  // Search YouTube
  const searched = await play.search(query, { limit: 1 });
  if (searched.length === 0) return null;
  return {
    url: searched[0].url,
    title: searched[0].title || "Unknown",
    duration: searched[0].durationRaw || "?",
    thumbnail: searched[0].thumbnails?.[0]?.url,
  };
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
