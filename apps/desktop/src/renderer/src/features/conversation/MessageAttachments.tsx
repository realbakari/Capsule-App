import { useEffect, useRef, useState } from "react";
import type { ChatMessage, MessageAttachment } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { FileIcon } from "../shell/icons";

function Attachment({ messageId, attachment, index, onOpen }: { messageId: string; attachment: MessageAttachment; index: number; onOpen: (path: string) => void }) {
  const { api } = useWorkspace();
  const control = useRef<HTMLButtonElement>(null);
  const [thumbnail, setThumbnail] = useState(attachment.thumbnail);
  const [unavailable, setUnavailable] = useState(false);
  const image = attachment.mimeType?.startsWith("image/");
  useEffect(() => {
    if (!image || attachment.thumbnail || !control.current) return;
    let disposed = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void api.messageImage(messageId, index).then((value) => {
        if (!disposed) { setThumbnail(value); setUnavailable(!value); }
      }, () => { if (!disposed) setUnavailable(true); });
    }, { rootMargin: "160px" });
    observer.observe(control.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [api, messageId, index, attachment.thumbnail, image]);
  return <button ref={control} type="button" className={`message-attachment${image ? " message-attachment-image" : ""}`}
    title={attachment.path} aria-label={`Open attachment ${attachment.name}`} onClick={() => onOpen(attachment.path)}>
    {image && <div className="message-image-preview">{thumbnail && !unavailable
      ? <img src={thumbnail} alt={attachment.name} onError={() => setUnavailable(true)} />
      : <span>{unavailable ? "Image preview unavailable" : "Loading image…"}</span>}</div>}
    <span className="message-attachment-caption"><FileIcon size={13} /><span>{attachment.name}</span><small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB</small></span>
  </button>;
}

export function MessageAttachments({ message, onOpen }: { message: ChatMessage; onOpen: (path: string) => void }) {
  if (!message.attachments?.length) return null;
  return <div className="message-attachments">{message.attachments.map((attachment, index) =>
    <Attachment key={`${message.id}:${attachment.path}:${index}`} messageId={message.id} attachment={attachment} index={index} onOpen={onOpen} />)}</div>;
}
