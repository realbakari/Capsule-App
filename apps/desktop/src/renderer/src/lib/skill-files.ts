import type { FileEntry, FilePreview } from "@capsule/shared";

interface SkillFilesState {
  listing: FileEntry[];
  children: Record<string, FileEntry[]>;
  expanded: Set<string>;
  loadingDirectories: Set<string>;
  directoryErrors: Record<string, string>;
  loading: boolean;
  error?: string;
  selected?: string;
  preview?: FilePreview;
  previewLoading: boolean;
  previewError?: string;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** One instance owns one skill. Only the newest file request may publish a preview. */
export class SkillFiles {
  private generation = 0;
  private previewVersion = 0;
  private listeners = new Set<() => void>();
  private state: SkillFilesState = {
    listing: [], children: {}, expanded: new Set(), loadingDirectories: new Set(),
    directoryErrors: {}, loading: true, previewLoading: false,
  };

  constructor(private skillId: string, private api: {
    listSkillFiles: (id: string, relative?: string) => Promise<FileEntry[]>;
    previewSkillFile: (id: string, relative: string) => Promise<FilePreview>;
  }) {}

  getSnapshot = (): SkillFilesState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<SkillFilesState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async load() {
    const generation = ++this.generation;
    ++this.previewVersion;
    this.update({ loading: true, error: undefined, listing: [], children: {}, expanded: new Set(),
      loadingDirectories: new Set(), directoryErrors: {}, selected: undefined, preview: undefined,
      previewLoading: false, previewError: undefined });
    try {
      const listing = await this.api.listSkillFiles(this.skillId);
      if (generation !== this.generation) return;
      this.update({ listing, loading: false });
      const first = listing.find((entry) => entry.type === "file" && entry.name === "SKILL.md")
        ?? listing.find((entry) => entry.type === "file");
      if (first && !this.state.selected) void this.select(first.path);
    } catch (error) {
      if (generation === this.generation) this.update({ loading: false, error: errorText(error) });
    }
  }

  async select(relative: string) {
    const generation = this.generation;
    const version = ++this.previewVersion;
    this.update({ selected: relative, preview: undefined, previewError: undefined, previewLoading: true });
    try {
      const preview = await this.api.previewSkillFile(this.skillId, relative);
      if (generation === this.generation && version === this.previewVersion) this.update({ preview });
    } catch (error) {
      if (generation === this.generation && version === this.previewVersion) this.update({ previewError: errorText(error) });
    } finally {
      if (generation === this.generation && version === this.previewVersion) this.update({ previewLoading: false });
    }
  }

  async toggle(relative: string) {
    const expanded = new Set(this.state.expanded);
    if (expanded.has(relative)) {
      expanded.delete(relative);
      this.update({ expanded });
      return;
    }
    expanded.add(relative);
    this.update({ expanded });
    if (!this.state.children[relative]) await this.loadDirectory(relative);
  }

  async loadDirectory(relative: string) {
    if (this.state.loadingDirectories.has(relative)) return;
    const generation = this.generation;
    const directoryErrors = { ...this.state.directoryErrors };
    delete directoryErrors[relative];
    this.update({ directoryErrors, loadingDirectories: new Set(this.state.loadingDirectories).add(relative) });
    try {
      const entries = await this.api.listSkillFiles(this.skillId, relative);
      if (generation === this.generation) this.update({ children: { ...this.state.children, [relative]: entries } });
    } catch (error) {
      if (generation === this.generation) this.update({ directoryErrors: { ...this.state.directoryErrors, [relative]: errorText(error) } });
    } finally {
      if (generation === this.generation) {
        const pending = new Set(this.state.loadingDirectories);
        pending.delete(relative);
        this.update({ loadingDirectories: pending });
      }
    }
  }
}
