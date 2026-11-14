/*
 * The clipboard, from the desktop window or from a browser on plain HTTP.
 * A paired browser on the network is not a secure context, so the async
 * clipboard API is missing there and the older copy command has to do.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("This browser blocked copying. Select the text and copy it yourself.");
}
