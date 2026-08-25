export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  source: "openclaw" | "capsule";
}

export const KNOWN_TOOLS: ToolDescriptor[] = [
  { id: "files", name: "Filesystem", description: "Project-scoped file access.", source: "capsule" },
  { id: "terminal", name: "Terminal", description: "Host command execution.", source: "openclaw" },
  { id: "git", name: "Git", description: "Repository status and diffs.", source: "capsule" },
  { id: "web_search", name: "Web search", description: "Search the public web.", source: "openclaw" },
  { id: "browser", name: "Browser", description: "Browser automation.", source: "openclaw" },
];
