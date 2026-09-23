import { createRoot } from "react-dom/client";
import { ChannelsView } from "../features/channels/ChannelsView";
import { ChannelAvatar, ChannelFeed } from "../features/channels/ChannelMessages";
import type { ChannelPost, ChannelUpdate, RelayConnectionInput, SharedChannel } from "@capsule/shared";

const first = "11111111-2222-3333-4444-555555555555";
const second = "22222222-2222-3333-4444-555555555555";
const human = "a".repeat(64), agent = "b".repeat(64), parent = "c".repeat(64);
const profileImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
async function until(check: () => unknown) {
  const until = Date.now() + 3000;
  while (!check()) { if (Date.now() > until) throw new Error(`Channel UI did not settle: ${check}`); await settle(); }
}
function fill(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
function fixture() {
  const channels: SharedChannel[] = [
    { id: first, name: "engineering", description: "Plan, build, and review together.", joined: true },
    { id: second, name: "design", description: "Interface reviews", joined: false },
  ];
  const posts: ChannelPost[] = [];
  const actions: string[] = [];
  let reacted = false, archived = false;
  let connected = true, remembered = false, reject = false, rejectReads = false, reads = 0;
  const connections: RelayConnectionInput[] = [];
  const status = () => ({ connected, remembered, hasSaved: remembered, canRemember: true, url: connected || remembered ? "https://relay.example" : undefined });
  const api = {
    isDesktop: true,
    relayStatus: async () => { reads++; return status(); },
    connectRelay: async (input: RelayConnectionInput) => { connections.push(input); connected = true; remembered = !!input.remember; return status(); },
    disconnectRelay: async () => { connected = false; return status(); },
    rememberRelay: async () => { remembered = true; return status(); },
    forgetRelay: async () => { connected = false; remembered = false; return status(); },
    channelAvatar: async () => profileImage,
    sharedChannelDetails: async () => ({ id: first, name: "engineering", description: "Plan, build, and review together.", visibility: "private" as const, channelType: "stream", archived }),
    updateSharedChannel: async (input: ChannelUpdate) => { Object.assign(channels.find((channel) => channel.id === input.channelId)!, { name: input.name, description: input.description }); actions.push("update"); },
    manageSharedChannel: async (_id: string, action: string) => { if (reject) throw new Error("The relay did not accept this change."); archived = action === "archive"; actions.push(action); },
    channelReactions: async () => reacted ? [{ emoji: "👍", count: 1, mine: true }] : [],
    reactToChannelMessage: async (_id: string, _emoji: string, action: string) => { if (reject) throw new Error("The relay did not accept this change."); reacted = action === "add"; actions.push(action); },
    listSharedChannels: async () => channels.map((channel) => ({ ...channel })),
    createSharedChannel: async () => first,
    channelMembership: async (id: string, action: string) => { channels.find((channel) => channel.id === id)!.joined = action === "join"; },
    channelMembers: async () => [{ pubkey: human, name: "Alex", role: "member" }, { pubkey: agent, name: "Reviewer", role: "bot" }],
    channelMessages: async (channelId: string, root?: string) => { if (rejectReads) throw new Error("Refresh unavailable"); return channelId === second ? [] : [
      { id: parent, author: human, content: "Please review the keyboard navigation before we release.\n\n- Check focus order.\n- Keep the changes scoped to the dialog.", createdAt: 1_790_170_000 },
      ...(root ? [{ id: "d".repeat(64), author: agent, content: "I’ll check the dialog and report the results here.\n\n```ts\nconst canClose = !pending;\n```", createdAt: 1_790_170_010, rootId: parent, replyTo: parent }] : []),
    ]; },
    postChannelMessage: async (post: ChannelPost) => { if (reject) throw new Error("The relay did not accept this change."); posts.push(post); return "e".repeat(64); },
    inviteChannelMember: async () => {},
    removeChannelMember: async () => {},
  };
  return { api, posts, actions, connections, fail: (value: boolean) => { reject = value; }, failReads: (value: boolean) => { rejectReads = value; }, reads: () => reads };
}

export async function runChannelRegressions(host: HTMLElement) {
  const previous = window.testWorkspace;
  const root = createRoot(host);
  const test = fixture();
  window.testWorkspace = { ...previous, api: test.api };
  try {
    root.render(<ChannelsView />);
    await until(() => host.querySelector(".channel-post"));
    const draft = host.querySelector<HTMLTextAreaElement>("textarea")!;
    fill(draft, "A draft for this channel"); await settle();
    host.querySelector<HTMLButtonElement>('[aria-label="Mention a channel member"]')!.click(); await settle();
    host.querySelectorAll<HTMLButtonElement>(".channel-mention-menu button")[1]!.click(); await settle();
    test.fail(true);
    host.querySelector<HTMLFormElement>(".channel-composer")!.requestSubmit(); await settle();
    await until(() => host.querySelector('[role="alert"]'));
    assert(draft.value === "A draft for this channel @Reviewer ", "Rejected channel post lost its draft or selected mention");
    test.fail(false);
    host.querySelector<HTMLFormElement>(".channel-composer")!.requestSubmit();
    await until(() => test.posts.length === 1 && !draft.value);
    assert(test.posts[0]!.mentions[0] === agent && test.posts[0]!.channelId === first, "A mention lost its explicit identity or channel");
    fill(draft, "Keep while browsing"); await settle();
    host.querySelectorAll<HTMLButtonElement>(".channel-link")[1]!.click(); await settle();
    assert(host.querySelector<HTMLTextAreaElement>("textarea")!.disabled, "Non-member could compose a message");
    host.querySelectorAll<HTMLButtonElement>(".channel-link")[0]!.click(); await settle();
    assert(host.querySelector<HTMLTextAreaElement>("textarea")!.value === "Keep while browsing", "Switching channel dropped its draft");
    await until(() => host.querySelector('[aria-label="Reply to Alex in thread"]'));
    host.querySelector<HTMLButtonElement>('[aria-label="Reply to Alex in thread"]')!.click();
    await until(() => host.querySelectorAll(".channel-thread .channel-post").length === 2);
    fill(host.querySelector<HTMLTextAreaElement>(".channel-thread textarea")!, "Thanks, reviewer"); await settle();
    host.querySelector<HTMLFormElement>(".channel-thread .channel-composer")!.requestSubmit();
    await until(() => test.posts.length === 2);
    assert(test.posts[1]!.replyTo === parent && test.posts[1]!.channelId === first, "Reply was sent to the channel instead of the thread");
    assert(host.scrollWidth <= host.clientWidth + 1, "Channel thread overflows the window");
    host.querySelector<HTMLButtonElement>('[aria-label="Close thread"]')!.click(); await settle();
    assert(host.querySelector(".channel-replies")?.textContent?.includes("1 reply") && host.querySelector(".channel-reply-avatars"), "Loaded thread summary lost its count or participant avatar");
    const currentDraft = host.querySelector<HTMLTextAreaElement>("textarea")!;
    fill(currentDraft, "Keyboard send"); await settle();
    currentDraft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })); await settle();
    assert(test.posts.length === 2, "Shift Enter sent a channel message");
    currentDraft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); await settle();
    assert(test.posts.length === 2, "Composing an input-method character sent a message");
    currentDraft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => test.posts.length === 3);

    fill(currentDraft, "Please @Rev"); await settle();
    assert(host.querySelectorAll(".channel-mention-menu button").length === 1, "Typing @ did not filter member suggestions");
    currentDraft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); await settle();
    assert(currentDraft.value === "Please @Rev" && Number(test.posts.length) === 3, "IME confirmation selected or sent a mention");
    currentDraft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await settle();
    assert(String(currentDraft.value) === "Please @Reviewer " && Number(test.posts.length) === 3, "Enter sent instead of selecting a typed mention");
    assert(host.querySelector(".channel-mentions")?.textContent?.includes("@Reviewer"), "Selected mention lost its identity chip");
    fill(currentDraft, "Please review this"); await settle();
    assert(!host.querySelector(".channel-mentions"), "Deleting a mention retained its recipient");
    currentDraft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(() => test.posts.length === 4);
    assert(test.posts[3]!.mentions.length === 0, "Deleted mention still notified its identity");

    host.querySelector<HTMLButtonElement>('[aria-label="Reactions"]')!.click();
    await until(() => host.querySelector<HTMLButtonElement>('[aria-label="Add 👍 reaction"]')?.disabled === false);
    test.fail(true); host.querySelector<HTMLButtonElement>('[aria-label="Add 👍 reaction"]')!.click();
    await until(() => host.querySelector(".channel-action-notice[role='alert']"));
    assert(!test.actions.includes("add"), "Rejected reaction appeared as accepted");
    test.fail(false); host.querySelector<HTMLButtonElement>('[aria-label="Add 👍 reaction"]')!.click();
    await until(() => host.querySelector('[aria-label="Remove 👍 reaction"]'));
    assert(host.querySelector(".channel-reaction-entry")?.textContent?.includes("You reacted"), "Own reaction state was not displayed");
    host.querySelector<HTMLButtonElement>('[aria-label="Remove 👍 reaction"]')!.click();
    await until(() => host.querySelector('[aria-label="Add 👍 reaction"]'));
    host.querySelector<HTMLButtonElement>('[aria-label="Close reactions"]')!.click(); await settle();

    Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.startsWith("Members ("))!.click(); await settle();
    const memberSearch = host.querySelector<HTMLInputElement>('[aria-label="Search channel members"]')!;
    fill(memberSearch, "review"); await settle();
    assert(host.querySelectorAll(".channel-members li").length === 1 && host.querySelector(".channel-members li")?.textContent?.includes("Reviewer"), "Member search did not filter profiles");
    host.querySelector<HTMLButtonElement>('[aria-label="Close members"]')!.click(); await settle();

    host.querySelector<HTMLButtonElement>('[aria-label="Channel settings"]')!.click();
    await until(() => host.querySelector(".channel-facts"));
    assert(host.querySelector(".channel-facts")?.textContent?.includes("Private"), "Channel settings did not show relay visibility");
    const settingsButton = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>(".channel-details button")).find((button) => button.textContent === label)!;
    settingsButton("Archive channel").click(); await settle();
    assert(!test.actions.includes("archive"), "Opening archive confirmation performed a write");
    settingsButton("Cancel").click(); await settle();
    settingsButton("Archive channel").click(); await settle(); settingsButton("Confirm archive").click();
    await until(() => settingsButton("Unarchive channel"));
    settingsButton("Unarchive channel").click(); await settle(); settingsButton("Confirm unarchive").click();
    await until(() => settingsButton("Archive channel"));
    settingsButton("Delete channel").click(); await settle();
    assert(settingsButton("Confirm delete").disabled && !test.actions.includes("delete"), "Channel deletion bypassed typed confirmation");
    settingsButton("Cancel").click(); await settle();
    host.querySelector<HTMLButtonElement>('[aria-label="Close channel settings"]')!.click(); await settle();

    test.failReads(true); fill(currentDraft, "Keep the last successful snapshot"); await settle();
    host.querySelector<HTMLFormElement>(".channel-composer")!.requestSubmit();
    await until(() => host.textContent?.includes("Refresh unavailable"));
    assert(host.querySelector(".channel-post") && !host.querySelector(".channel-welcome"), "A failed refresh erased loaded messages or claimed an empty channel");
    test.failReads(false); fill(currentDraft, "Refresh again"); await settle();
    host.querySelector<HTMLFormElement>(".channel-composer")!.requestSubmit();
    await until(() => !host.textContent?.includes("Refresh unavailable"));

    const create = host.querySelector<HTMLButtonElement>('[aria-label="Create channel"]')!;
    create.focus(); create.click(); await settle();
    const dialog = document.querySelector<HTMLDialogElement>(".channel-dialog")!;
    assert(dialog.open && dialog.contains(document.activeElement), "Create channel did not trap focus in its dialog");
    dialog.dispatchEvent(new Event("cancel", { cancelable: true })); await settle();
    assert(!document.querySelector(".channel-dialog") && document.activeElement === create, "Closing the dialog did not return focus");

    host.querySelector<HTMLElement>(".channel-connection-menu summary")!.click(); await settle();
    const remember = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Remember on this device")!;
    remember.click(); await until(() => host.textContent?.includes("Remembered securely"));
    const disconnect = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Disconnect")!;
    disconnect.click(); await until(() => host.querySelector(".channels-setup"));
    assert(!host.querySelector(".channel-post"), "Disconnect retained private channel content");
    assert(host.querySelector<HTMLInputElement>('input[type="url"]')!.value === "https://relay.example", "Disconnect lost the saved relay URL");
    assert(!host.querySelector<HTMLInputElement>('input[type="password"]')!.value, "Saved key was sent back to the renderer");
    host.querySelector<HTMLFormElement>(".channels-setup")!.requestSubmit();
    await until(() => host.querySelector(".channel-post"));
    assert(test.connections[0]?.privateKey === "" && test.connections[0]?.url === "https://relay.example", "Reconnect required re-entering saved credentials");
    host.querySelector<HTMLElement>(".channel-connection-menu summary")!.click(); await settle();
    Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Forget connection")!.click();
    await until(() => host.querySelector(".channels-setup"));
    assert(host.querySelector<HTMLInputElement>('input[type="url"]')!.value !== "https://relay.example", "Forget retained the saved relay URL");
    assert(host.querySelector<HTMLInputElement>('input[type="password"]')!.required, "Forget still allowed using a saved key");

    root.render(<ChannelAvatar identity={human} member={{ pubkey: human, name: "Alex", role: "member", picture: "https://relay.example/photo" }} />);
    await until(() => host.querySelector(".channel-avatar img"));
    assert(host.querySelector<HTMLImageElement>("img")!.src === profileImage, "Avatar did not use the relay-provided image bytes");
    host.querySelector<HTMLImageElement>("img")!.dispatchEvent(new Event("error")); await settle();
    assert(!host.querySelector("img") && host.textContent === "A", "Broken profile image did not fall back to initials");
    root.render(<ChannelAvatar identity={agent} member={{ pubkey: agent, name: "Reviewer", role: "bot" }} />); await settle();
    assert(!host.querySelector("img, svg") && String(host.textContent) === "R", "Agent without a profile received a made-up avatar");

    root.render(null); await settle();
    const reads = test.reads();
    window.testWorkspace = { ...previous, api: { ...test.api, isDesktop: false } };
    root.render(<ChannelsView />); await settle();
    assert(test.reads() === reads && !host.querySelector("input"), "A paired viewer reached the shared identity");

    // Repeated server snapshots must not jump a reader to the bottom.
    const messages = Array.from({ length: 30 }, (_, index) => ({ id: String(index), author: human, content: `Message ${index}`, createdAt: 1_790_170_000 + index }));
    const renderFeed = () => root.render(<div style={{ display: "flex", height: 200 }}><ChannelFeed messages={[...messages]} members={[]} /></div>);
    renderFeed(); await settle();
    const feed = host.querySelector<HTMLDivElement>(".channel-feed")!;
    assert(feed.scrollTop > 0, "Initial channel history did not open at the latest message");
    feed.scrollTop = 0; feed.dispatchEvent(new Event("scroll", { bubbles: true })); await settle();
    messages.push({ id: "new", author: human, content: "New message", createdAt: 1_790_170_099 });
    renderFeed(); await settle();
    assert(feed.scrollTop === 0 && host.querySelector(".channel-latest"), "Polling pulled the reader away from older messages");
    host.querySelector<HTMLButtonElement>(".channel-latest")!.click(); await settle();
    assert(feed.scrollTop > 0, "Latest messages did not return to the end");
  } finally { root.unmount(); window.testWorkspace = previous; }
}

export async function renderChannelPreview(root: ReturnType<typeof createRoot>, host: HTMLElement, surface: "channel" | "thread" | "members" | "empty" | "settings" | "mentions" | "reactions") {
  root.render(null); await settle();
  window.testWorkspace = { ...window.testWorkspace, api: fixture().api };
  root.render(<div style={{ height: "100vh", display: "flex", minWidth: 0 }}><ChannelsView /></div>);
  await until(() => host.querySelector('[aria-label="Reply to Alex in thread"]'));
  if (surface === "thread") {
    host.querySelector<HTMLButtonElement>('[aria-label="Reply to Alex in thread"]')!.click();
    await until(() => host.querySelectorAll(".channel-thread .channel-post").length === 2);
  }
  if (surface === "settings") { host.querySelector<HTMLButtonElement>('[aria-label="Channel settings"]')!.click(); await until(() => host.querySelector(".channel-facts")); }
  if (surface === "mentions") { fill(host.querySelector<HTMLTextAreaElement>("textarea")!, "Please @"); await until(() => host.querySelector(".channel-mention-menu")); }
  if (surface === "reactions") { host.querySelector<HTMLButtonElement>('[aria-label="Reactions"]')!.click(); await until(() => host.querySelector<HTMLButtonElement>('[aria-label="Add 👍 reaction"]')?.disabled === false); }
  if (surface === "members") {
    Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.startsWith("Members ("))!.click();
    await until(() => host.querySelector(".channel-member-drawer"));
  }
  if (surface === "empty") { host.querySelectorAll<HTMLButtonElement>(".channel-link")[1]!.click(); await until(() => host.querySelector(".channel-welcome")); }
  await settle();
  assert(host.scrollWidth <= host.clientWidth + 1, "Channel preview overflows horizontally");
  const compose = host.querySelector<HTMLElement>(surface === "thread" ? ".channel-thread .channel-composer" : ".channel-main .channel-composer")!;
  assert(compose.getBoundingClientRect().bottom <= window.innerHeight + 1, "Composer is outside the viewport");
}
