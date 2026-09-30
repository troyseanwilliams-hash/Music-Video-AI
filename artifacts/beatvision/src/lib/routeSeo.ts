// The same route metadata is used by the SPA and by the static HTML build.
// Keep canonical URLs on the verified production origin, never the preview host.
export const SITE_ORIGIN = "https://aibeatsync.com";
export const SHARE_IMAGE = `${SITE_ORIGIN}/opengraph.jpg`;

export interface RouteSeo {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}

export const publicRouteSeo: Record<string, RouteSeo> = {
  "/": {
    path: "/",
    title: "AI Music Video & Creative Studio | AIBeatSync",
    description: "Get 150 free credits when you create your AIBeatSync account. Enough for about 21 images, or 1 video clip plus several images. Actual usage varies by model and settings. Unused welcome credits expire when your 7-day trial ends.",
  },
  "/images": {
    path: "/images",
    title: "AI Image Generator for Video Projects | AIBeatSync",
    description: "Create AI images from your prompts and build visuals for music videos and stories. Choose a style, review scenes and bring your ideas to life with AIBeatSync.",
  },
  "/soundtracks": {
    path: "/soundtracks",
    title: "AI Music Generator & Soundtracks | AIBeatSync",
    description: "Make original AI soundtracks for your creative projects. Describe the mood, add your own lyrics and generate music to use in videos with AIBeatSync.",
  },
  "/generate": {
    path: "/generate",
    title: "AI Music Video Generator | AIBeatSync",
    description: "Upload a track and create a music video with AIBeatSync. Build visual scenes from your ideas, explore styles and sync your video to the sound of your music.",
  },
  "/pricing": {
    path: "/pricing",
    title: "AI Video, Image & Music Pricing | AIBeatSync",
    description: "Get 150 free credits when you create your AIBeatSync account. Enough for about 21 images, or 1 video clip plus several images. Actual usage varies by model and settings. Unused welcome credits expire when your 7-day trial ends. Explore plans for music, images and video.",
  },
  // /gallery is the signed-in customer's library, not the public community gallery.
  "/gallery": {
    path: "/gallery",
    title: "Your Video & Image Gallery | AIBeatSync",
    description: "View and manage your own AIBeatSync videos, images and creative projects in your private gallery.",
    noindex: true,
  },
  "/login": {
    path: "/login",
    title: "Sign In to Your Account | AIBeatSync",
    description: "Sign in to AIBeatSync to manage your creative projects, credits, videos and subscription.",
    noindex: true,
  },
  "/register": {
    path: "/register",
    title: "Create Your AIBeatSync Account | AIBeatSync",
    description: "Get 150 free credits when you create your AIBeatSync account. Enough for about 21 images, or 1 video clip plus several images. Actual usage varies by model and settings. Unused welcome credits expire when your 7-day trial ends.",
    noindex: true,
  },
  "/explore": {
    path: "/explore",
    title: "Explore Community AI Videos & Images | AIBeatSync",
    description: "Browse public AI music videos, images and music shared by the AIBeatSync community. Discover creative work and ideas from other creators.",
  },
};

const privatePaths = new Set([
  "/editor", "/dashboard", "/prompt-studio", "/settings", "/redeem",
  "/forgot-password", "/reset-password", "/admin", "/admin/runway-lipsync",
  "/suite", "/podcast",
]);

export const legacyPublicPaths = new Set([
  "/terms", "/dmca", "/privacy", "/support", "/compare", "/suno",
  "/spotify-canvas", "/ai-music-video-generator", "/ai-lyric-video",
  "/instrumental-generator", "/suno-to-video", "/tutorial/script-to-video",
  "/podcast-to-video", "/hip-hop-music-video-generator",
  "/edm-music-video-generator", "/rock-music-video-generator",
  "/pop-music-video-generator", "/country-music-video-generator",
  "/lofi-music-video-generator", "/slideshow-maker",
  "/wedding-slideshow-maker", "/capcut-alternative", "/lyric-sync",
]);

export function seoForPath(pathname: string): RouteSeo {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/signup") return publicRouteSeo["/register"];
  if (publicRouteSeo[path]) return publicRouteSeo[path];
  if (privatePaths.has(path) || /^(\/(?:admin|jobs|s|image|podcast)\/)/.test(path)) {
    return {
      path,
      title: "Your AIBeatSync Studio | AIBeatSync",
      description: "Your AIBeatSync account and creative projects.",
      noindex: true,
    };
  }
  if (legacyPublicPaths.has(path)) {
    return {
      path,
      title: "AIBeatSync | Creative Tools for Music and Video",
      description: "Explore AIBeatSync's creative tools for music and video.",
    };
  }
  // Existing marketing and legal routes still retain their own page metadata.
  // Unrecognized paths must never accidentally inherit the indexable home page.
  return {
    path,
    title: "AIBeatSync | Page",
    description: "Explore AIBeatSync's creative tools for music and video.",
    noindex: true,
  };
}

export function applyRouteSeo(seo: RouteSeo, doc: Document = document): void {
  doc.title = seo.title;
  const canonical = SITE_ORIGIN + seo.path;
  const upsertMeta = (key: "name" | "property", name: string, value: string) => {
    const matches = doc.head.querySelectorAll<HTMLMetaElement>(`meta[${key}="${name}"]`);
    const element = matches[0] ?? doc.createElement("meta");
    for (const duplicate of Array.from(matches).slice(1)) duplicate.remove();
    element.setAttribute(key, name);
    element.content = value;
    if (!element.parentNode) doc.head.appendChild(element);
  };
  const canonicals = doc.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]');
  const link = canonicals[0] ?? doc.createElement("link");
  for (const duplicate of Array.from(canonicals).slice(1)) duplicate.remove();
  link.rel = "canonical";
  link.href = canonical;
  if (!link.parentNode) doc.head.appendChild(link);
  upsertMeta("name", "description", seo.description);
  upsertMeta("name", "robots", seo.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large");
  upsertMeta("property", "og:title", seo.title);
  upsertMeta("property", "og:description", seo.description);
  upsertMeta("property", "og:url", canonical);
  upsertMeta("property", "og:image", SHARE_IMAGE);
  upsertMeta("property", "og:type", "website");
  upsertMeta("name", "twitter:title", seo.title);
  upsertMeta("name", "twitter:description", seo.description);
  upsertMeta("name", "twitter:image", SHARE_IMAGE);
  upsertMeta("name", "twitter:card", "summary_large_image");
}

export function renderRouteHtml(html: string, seo: RouteSeo): string {
  const canonical = SITE_ORIGIN + seo.path;
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(seo.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escape(seo.description)}$2`)
    .replace(/(<meta name="robots" content=")[^"]*(")/, `$1${seo.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large"}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${escape(canonical)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${escape(canonical)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escape(seo.title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escape(seo.description)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escape(seo.title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${escape(seo.description)}$2`);
}