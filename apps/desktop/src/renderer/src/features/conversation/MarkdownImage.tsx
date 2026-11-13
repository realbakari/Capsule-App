import { memo, useEffect, useMemo, useState } from "react";
import { displayImageUrl, markdownImageSource } from "../../lib/markdown-media";
import { GlobeIcon } from "../shell/icons";
import { ImageZoomDialog } from "./ImageZoomDialog";
import "./markdown-media.css";

/** Reads a project image as a data URL through the file-preview channel. */
export type LoadImage = (path: string) => Promise<string>;

/* One read per loader and path: a reply re-renders on every streamed token. */
const reads = new WeakMap<LoadImage, Map<string, Promise<string>>>();

function readImage(load: LoadImage, path: string): Promise<string> {
  let byPath = reads.get(load);
  if (!byPath) reads.set(load, byPath = new Map());
  let read = byPath.get(path);
  if (!read) {
    read = load(path);
    byPath.set(path, read);
    read.catch(() => byPath!.delete(path));
    if (byPath.size > 64) byPath.delete(byPath.keys().next().value!);
  }
  return read;
}

function ZoomableImage({ src, alt, title }: { src: string; alt: string; title?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="md-image" title={title ?? "Open image"} aria-label={alt ? `Open image: ${alt}` : "Open image"} onClick={() => setOpen(true)}>
      <img src={src} alt={alt} loading="lazy" draggable={false} />
    </button>
    {open && <ImageZoomDialog src={src} alt={alt} onClose={() => setOpen(false)} />}
  </>;
}

type LocalState = { status: "loading" } | { status: "ready"; url: string } | { status: "failed"; reason: string };

function LocalImage({ path, alt, title, load, onOpenFile }: {
  path: string; alt: string; title?: string; load: LoadImage; onOpenFile?: (path: string) => void;
}) {
  const [state, setState] = useState<{ path: string; value: LocalState }>({ path, value: { status: "loading" } });
  useEffect(() => {
    let live = true;
    readImage(load, path).then(
      (url) => ({ status: "ready" as const, url }),
      (error: unknown) => ({ status: "failed" as const, reason: (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") }),
    ).then((value) => { if (live) setState({ path, value }); });
    return () => { live = false; };
  }, [load, path]);
  const value = state.path === path ? state.value : { status: "loading" as const };
  if (value.status === "ready") return <ZoomableImage src={value.url} alt={alt} title={title ?? path} />;
  const name = path.split(/[\\/]/).pop() || path;
  return <span className={`md-image-card${value.status === "failed" ? " is-failed" : ""}`} title={value.status === "failed" ? value.reason : path}>
    <span className="md-image-card-text">
      <span className="md-image-card-label">{alt || name}</span>
      <span className="md-image-card-detail">{value.status === "loading" ? "Loading image…" : `Could not show ${name}: ${value.reason}`}</span>
    </span>
    {value.status === "failed" && onOpenFile && <button type="button" className="md-media-button" onClick={() => onOpenFile(path)}>Show file</button>}
  </span>;
}

function RemoteImage({ url, alt, onOpenLink }: { url: string; alt: string; onOpenLink?: (href: string) => void }) {
  return <span className="md-image-card" title="Web images do not load inside replies. Open shows it in the browser panel.">
    <GlobeIcon size={14} />
    <span className="md-image-card-text">
      <span className="md-image-card-label">{alt || "Web image"}</span>
      <span className="md-image-card-detail md-image-card-url">{displayImageUrl(url)}</span>
    </span>
    <button type="button" className="md-media-button" aria-label={`Open image ${displayImageUrl(url)} in the browser panel`}
      onClick={() => onOpenLink ? onOpenLink(url) : window.open(url, "_blank", "noopener")}>Open</button>
  </span>;
}

export const MarkdownImage = memo(function MarkdownImage({ src, alt, title, baseUrl, inLink, loadImage, onOpenFile, onOpenLink }: {
  src: string; alt: string; title?: string; baseUrl?: string; inLink?: boolean;
  loadImage?: LoadImage; onOpenFile?: (path: string) => void; onOpenLink?: (href: string) => void;
}) {
  const source = useMemo(() => markdownImageSource(src, baseUrl), [src, baseUrl]);
  // Badges inside links keep their label; a placeholder or button cannot nest in a link.
  if (inLink && source.kind !== "data") return <>{alt || "Image"}</>;
  switch (source.kind) {
    case "data": return inLink ? <img className="md-image-inline" src={source.url} alt={alt} /> : <ZoomableImage src={source.url} alt={alt} title={title} />;
    case "remote": return <RemoteImage url={source.url} alt={alt} onOpenLink={onOpenLink} />;
    case "local":
      if (loadImage) return <LocalImage path={source.path} alt={alt} title={title} load={loadImage} onOpenFile={onOpenFile} />;
      return onOpenFile
        ? <button type="button" className="md-file-link" title={source.path} onClick={() => onOpenFile(source.path)}>{alt || "Image"}</button>
        : <>{alt || "Image"}</>;
    default: return <>{alt || "Image"}</>;
  }
});
