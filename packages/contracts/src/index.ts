import {
  createId,
  type AgentMode,
  type ExecutionContract,
  type OutputDetail,
  type SandboxMode,
  type WebAccess,
} from "@capsule/shared";

export function buildContract(input: {
  mode: AgentMode;
  prompt: string;
  workingDirectory?: string;
  runId?: string;
  outputDetail?: OutputDetail;
  webAccess?: WebAccess;
  sandbox?: SandboxMode;
}): ExecutionContract {
  const required = [];
  const forbidden = [
    {
      id: "no-restricted-dirs",
      description: "Do not access restricted directories such as ~/.ssh or Keychain.",
      kind: "path" as const,
      value: "restricted",
    },
    {
      id: "no-destructive",
      description: "Do not perform destructive actions unless explicitly requested.",
      kind: "action" as const,
      value: "destructive",
    },
  ];

  if (input.mode === "plan") {
    required.push({
      id: "produce-plan",
      description: "Produce a concrete plan with files to touch and verification steps. Do not edit files yet.",
      kind: "output_contains" as const,
      value: "plan",
    });
  }

  if (input.mode === "code") {
    required.push({
      id: "describe-changes",
      description: "Describe the files changed and how to verify them.",
      kind: "output_contains" as const,
      value: "files",
    });
    forbidden.push({
      id: "no-auto-commit",
      description: "Never automatically commit unless explicitly requested.",
      kind: "action" as const,
      value: "git-commit",
    });
  }

  if (input.mode === "research" && input.webAccess !== "off") {
    required.push({
      id: "include-sources",
      description: "Include sources for claims gathered from the web.",
      kind: "output_contains" as const,
      value: "source",
    });
  }

  if (input.outputDetail === "verbose") {
    required.push({
      id: "verbose-detail",
      description: "Include files touched, commands run, and how to verify.",
      kind: "custom" as const,
    });
  }

  if (input.outputDetail === "concise") {
    required.push({
      id: "stay-concise",
      description: "Keep the reply short. Do not restate the request.",
      kind: "custom" as const,
    });
  }

  if (input.webAccess === "off") {
    forbidden.push({
      id: "no-web",
      description: "Do not use web search or fetch URLs.",
      kind: "action" as const,
      value: "web",
    });
  }

  if (input.sandbox === "strict") {
    forbidden.push({
      id: "no-shell",
      description: "Do not run shell commands.",
      kind: "action" as const,
      value: "terminal",
    });
  }

  const humanSummary = [
    "Required:",
    ...required.map((item) => `✓ ${item.description}`),
    required.length === 0 ? "✓ Complete the requested work" : "",
    "",
    "Forbidden:",
    ...forbidden.map((item) => `✕ ${item.description}`),
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    id: createId("ctr"),
    runId: input.runId,
    required:
      required.length > 0
        ? required
        : [
            {
              id: "complete-work",
              description: "Complete the requested work.",
              kind: "custom",
            },
          ],
    forbidden,
    humanSummary,
  };
}
