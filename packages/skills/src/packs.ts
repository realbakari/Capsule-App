import type { Skill, SkillPack } from "@capsule/shared";

export const PACKED_SKILLS: Skill[] = [
  // Base capabilities
  {
    id: "coding",
    name: "Coding",
    version: "1.0.0",
    description: "Implement, refactor, and review source code.",
    source: "capsule",
    status: "installed",
    requirements: [],
    permissions: { filesystem: "approval", terminal: "approval" },
    validation: "passed",
    tags: ["core", "development"],
    content: `# Coding Skill

## Procedural Instructions
1. Inspect project directory structure and existing code conventions before modifying files.
2. Formulate minimal, non-breaking modifications and verify syntax.
3. Avoid unnecessary dependencies or rewriting unaffected files.
4. Run project test suites or typechecks to ensure regressions are not introduced.`,
  },
  {
    id: "research",
    name: "Research",
    version: "1.0.0",
    description: "Gather sources and produce cited analysis.",
    source: "capsule",
    status: "installed",
    requirements: ["network"],
    permissions: { network: "allow" },
    validation: "passed",
    tags: ["core", "analysis"],
    content: `# Research Skill

## Procedural Instructions
1. Formulate clear search queries with specific keywords.
2. Extract verified facts from authoritative sources and preprints.
3. Provide Markdown tables, citations with clickable links, and summaries.`,
  },
  {
    id: "browser",
    name: "Browser",
    version: "1.0.0",
    description: "Inspect and interact with web pages.",
    source: "openclaw",
    status: "installed",
    requirements: [],
    permissions: { network: "allow" },
    validation: "passed",
    tags: ["core", "web"],
    content: `# Browser Skill

## Procedural Instructions
1. Use page navigation and DOM inspection to locate target elements.
2. Prefer accessible selectors (role, aria-label, text content) over transient CSS classes.
3. Validate visual layouts and responsive viewport behavior.`,
  },
  {
    id: "git",
    name: "Git",
    version: "1.0.0",
    description: "Inspect branches, diffs, and commits. Never auto-commit.",
    source: "capsule",
    status: "installed",
    requirements: ["git"],
    permissions: { git: "allow" },
    validation: "passed",
    tags: ["core", "version-control"],
    content: `# Git Skill

## Procedural Instructions
1. Inspect repository state, active branch, and modified files before git operations.
2. Never auto-commit or push without explicit user command or approval.
3. Generate concise, semantic commit messages summarizing changes.`,
  },
  {
    id: "testing",
    name: "Testing",
    version: "1.0.0",
    description: "Run and interpret project tests.",
    source: "capsule",
    status: "installed",
    requirements: [],
    permissions: { terminal: "approval" },
    validation: "passed",
    tags: ["core", "testing"],
    content: `# Testing Skill

## Procedural Instructions
1. Identify project test runners (Vitest, Jest, Playwright, Pytest, Go test).
2. Execute tests in targeted test suites before running full repository suites.
3. Parse and highlight assertion failures and stack traces concisely.`,
  },

  // --- Web & React Pack (from skills.sh) ---
  {
    id: "nextjs",
    name: "Next.js",
    version: "15.1.0",
    description: "Next.js 15 App Router, Server Components, Server Actions, caching, and streaming.",
    source: "skills.sh/vercel-labs/nextjs",
    status: "installed",
    packId: "web-react-pack",
    packName: "Web & React Pack",
    author: "vercel-labs",
    tags: ["react", "nextjs", "frontend", "ssr"],
    requirements: ["node"],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/vercel-labs/skills/nextjs",
    content: `# Next.js 15 App Router Skill

## Architecture Guidelines
- Use React Server Components (RSC) by default. Add \`"use client"\` only when state, event handlers, or browser APIs are required.
- Place data fetching directly inside Server Components using \`fetch()\` with appropriate \`next: { revalidate }\` or \`cache\` tags.
- Use Server Actions (\`"use server"\`) for mutations and form submissions. Always validate input with Zod and sanitize data.
- Optimize routing layouts, loading boundaries (\`loading.tsx\`), and error states (\`error.tsx\`).
- Implement dynamic Open Graph tags with \`generateMetadata()\` or \`opengraph-image.tsx\`.`,
  },
  {
    id: "react",
    name: "React 19",
    version: "19.0.0",
    description: "Modern React 19 patterns, Actions, useActionState, useOptimistic, and Compiler rules.",
    source: "skills.sh/facebook/react",
    status: "installed",
    packId: "web-react-pack",
    packName: "Web & React Pack",
    author: "facebook",
    tags: ["react", "frontend", "hooks"],
    requirements: ["node"],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/facebook/skills/react",
    content: `# React 19 Best Practices Skill

## Guidelines
- Leverage React 19 features: \`useActionState\`, \`useOptimistic\`, \`useFormStatus\`, and direct ref passing as props without \`forwardRef\`.
- Keep render functions pure and free of side effects.
- Avoid unnecessary \`useEffect\` chains for derived state; compute values during rendering.
- Use React Transition API (\`useTransition\`) for non-blocking UI updates.`,
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    version: "4.0.0",
    description: "Modern Tailwind CSS v4 styling, tokens, responsive breakpoints, and container queries.",
    source: "skills.sh/tailwindlabs/tailwind",
    status: "installed",
    packId: "web-react-pack",
    packName: "Web & React Pack",
    author: "tailwindlabs",
    tags: ["css", "styling", "tailwind", "design"],
    requirements: [],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/tailwindlabs/skills/tailwind",
    content: `# Tailwind CSS v4 Skill

## Guidelines
- Utilize CSS theme tokens (\`@theme\`) instead of hardcoded hex values.
- Apply mobile-first responsive utilities (\`sm:\`, \`md:\`, \`lg:\`, \`xl:\`).
- Maintain accessible color contrast ratios and dark mode tokens (\`dark:\`).
- Use \`clsx\` or \`cn()\` utility for merging dynamic class names cleanly.`,
  },
  {
    id: "shadcn",
    name: "Shadcn UI",
    version: "2.1.0",
    description: "Accessible Radix UI primitives with Tailwind CSS patterns and component composition.",
    source: "skills.sh/shadcn/ui",
    status: "installed",
    packId: "web-react-pack",
    packName: "Web & React Pack",
    author: "shadcn",
    tags: ["ui", "components", "radix", "accessibility"],
    requirements: ["node"],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/shadcn/skills/ui",
    content: `# Shadcn UI Component Skill

## Guidelines
- Build reusable UI components based on Radix UI primitives for full keyboard navigation and ARIA compliance.
- Keep components inside \`components/ui\` and compose higher-level features on top of them.
- Follow consistent props forwarding and \`React.ComponentPropsWithoutRef\` patterns.`,
  },

  // --- Backend & Database Pack (from skills.sh) ---
  {
    id: "supabase",
    name: "Supabase",
    version: "2.40.0",
    description: "Postgres database design, Row Level Security (RLS), Edge Functions, Auth, and Realtime.",
    source: "skills.sh/supabase/supabase",
    status: "installed",
    packId: "backend-db-pack",
    packName: "Backend & Database Pack",
    author: "supabase",
    tags: ["database", "postgres", "auth", "backend"],
    requirements: ["network"],
    permissions: { network: "allow", filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/supabase/skills/supabase",
    content: `# Supabase Postgres & RLS Skill

## Guidelines
- Always enable Row Level Security (\`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;\`) on every table.
- Write granular RLS policies for SELECT, INSERT, UPDATE, and DELETE scoping to \`auth.uid()\`.
- Generate type-safe database definitions using \`supabase gen types typescript\`.
- Use Postgres indexes for frequently queried foreign keys and filtered columns.`,
  },
  {
    id: "prisma",
    name: "Prisma ORM",
    version: "6.0.0",
    description: "Prisma schema modelling, migrations, relational queries, transactions, and indexing.",
    source: "skills.sh/prisma/prisma",
    status: "installed",
    packId: "backend-db-pack",
    packName: "Backend & Database Pack",
    author: "prisma",
    tags: ["database", "orm", "typescript", "backend"],
    requirements: ["node"],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/prisma/skills/prisma",
    content: `# Prisma ORM Skill

## Guidelines
- Define explicit relations, indexes, and unique constraints in \`schema.prisma\`.
- Use interactive transactions (\`prisma.$transaction\`) for multi-step mutations.
- Prevent N+1 queries by selecting only required fields and using \`include\` strategically.`,
  },
  {
    id: "cloudflare-workers",
    name: "Cloudflare Workers",
    version: "3.0.0",
    description: "Edge serverless functions, KV, D1 SQL database, Hyperdrive, and Vectorize.",
    source: "skills.sh/cloudflare/workers",
    status: "installed",
    packId: "backend-db-pack",
    packName: "Backend & Database Pack",
    author: "cloudflare",
    tags: ["edge", "serverless", "cloudflare", "backend"],
    requirements: ["node"],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/cloudflare/skills/workers",
    content: `# Cloudflare Workers & Edge Compute Skill

## Guidelines
- Follow standard Fetch event handler syntax (\`export default { async fetch(request, env, ctx) { ... } }\`).
- Utilize KV and D1 bindings efficiently with caching headers and execution context wait-untils (\`ctx.waitUntil\`).`,
  },

  // --- Testing & Quality Pack (from skills.sh) ---
  {
    id: "vitest",
    name: "Vitest",
    version: "3.0.0",
    description: "Fast unit and integration testing with ESM, TypeScript, mocks, and snapshot testing.",
    source: "skills.sh/vitest-dev/vitest",
    status: "installed",
    packId: "testing-qa-pack",
    packName: "Testing & Quality Pack",
    author: "vitest-dev",
    tags: ["testing", "vitest", "unit-test", "qa"],
    requirements: ["node"],
    permissions: { terminal: "approval" },
    validation: "passed",
    url: "https://skills.sh/vitest-dev/skills/vitest",
    content: `# Vitest Testing Skill

## Guidelines
- Write deterministic, isolated unit tests.
- Mock external I/O (files, network, databases) cleanly using \`vi.mock()\` or dependency injection.
- Use \`describe\`, \`it\`, and semantic assertion messages.`,
  },
  {
    id: "playwright",
    name: "Playwright",
    version: "1.49.0",
    description: "End-to-end browser automation, visual regressions, network interception, and traces.",
    source: "skills.sh/microsoft/playwright",
    status: "installed",
    packId: "testing-qa-pack",
    packName: "Testing & Quality Pack",
    author: "microsoft",
    tags: ["testing", "e2e", "browser", "automation"],
    requirements: ["node"],
    permissions: { terminal: "approval" },
    validation: "passed",
    url: "https://skills.sh/microsoft/skills/playwright",
    content: `# Playwright E2E Skill

## Guidelines
- Use user-facing locators (\`getByRole\`, \`getByText\`, \`getByLabel\`) over CSS selectors.
- Rely on auto-waiting assertions (\`await expect(locator).toBeVisible()\`) rather than explicit delays.
- Capture screenshots or traces upon test failure for quick diagnosis.`,
  },

  // --- Agent Workflows & Automation Pack (from skills.sh) ---
  {
    id: "github-actions",
    name: "GitHub Actions",
    version: "2.0.0",
    description: "CI/CD pipelines, automated testing, releases, secret management, and matrix builds.",
    source: "skills.sh/actions/workflow",
    status: "installed",
    packId: "agent-workflows-pack",
    packName: "Agent Workflows & Automation Pack",
    author: "actions",
    tags: ["ci-cd", "github", "devops", "automation"],
    requirements: [],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/actions/skills/workflow",
    content: `# GitHub Actions Workflow Skill

## Guidelines
- Pin action versions to immutable SHA commits or verified tags.
- Secure workflows by adhering to minimum token permissions (\`permissions: contents: read\`).
- Implement caching for dependencies (pnpm, npm, pip, go) to accelerate pipeline execution.`,
  },
  {
    id: "docker",
    name: "Docker & Containers",
    version: "27.0.0",
    description: "Multi-stage Dockerfiles, compose setups, container isolation, and image optimization.",
    source: "skills.sh/docker/docker",
    status: "installed",
    packId: "agent-workflows-pack",
    packName: "Agent Workflows & Automation Pack",
    author: "docker",
    tags: ["docker", "containers", "devops"],
    requirements: ["docker"],
    permissions: { terminal: "approval" },
    validation: "passed",
    url: "https://skills.sh/docker/skills/docker",
    content: `# Docker Optimization Skill

## Guidelines
- Utilize multi-stage builds to separate build dependencies from minimal production runtime images.
- Optimize layer caching by copying dependency manifests prior to source code.
- Avoid running containers as root; define non-privileged users.`,
  },

  // --- Design & UI Pack (from skills.sh) ---
  {
    id: "lucide",
    name: "Lucide Icons",
    version: "1.0.0",
    description: "Accessible, clean SVG icons with React/Vue bindings and dynamic sizing.",
    source: "skills.sh/lucide-icons/lucide",
    status: "installed",
    packId: "design-ui-pack",
    packName: "Design & UI Pack",
    author: "lucide-icons",
    tags: ["icons", "svg", "ui", "design"],
    requirements: [],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/lucide-icons/skills/lucide",
    content: `# Lucide Icons Skill

## Guidelines
- Ensure all icons include appropriate \`aria-hidden="true"\` when decorative or \`aria-label\` when interactive.
- Use standard stroke widths (1.5px - 2px) and cohesive size variants (16px, 20px, 24px).`,
  },
  {
    id: "python",
    name: "Python 3.12",
    version: "3.12.0",
    description: "Modern Python type annotations, asyncio concurrency, Pytest test suites, and packaging.",
    source: "skills.sh/python/python",
    status: "installed",
    tags: ["python", "backend", "asyncio", "typing"],
    requirements: ["python"],
    permissions: { filesystem: "approval", terminal: "approval" },
    validation: "passed",
    url: "https://skills.sh/python/skills/python",
    content: `# Python 3.12 Best Practices Skill

## Guidelines
- Use modern Python type hints (\`list[str]\`, \`str | None\`, \`typing.Self\`).
- Prefer structured exception handling and context managers (\`async with\`, \`with\`).
- Write unit tests using pytest fixtures and parametrization.
- Use virtual environments and modern pyproject.toml packaging.`,
  },
  {
    id: "typescript",
    name: "TypeScript 5",
    version: "5.7.0",
    description: "Strict TypeScript types, generics, conditional types, satisfies operator, and declaration maps.",
    source: "skills.sh/microsoft/typescript",
    status: "installed",
    tags: ["typescript", "javascript", "types", "compiler"],
    requirements: ["node"],
    permissions: { filesystem: "approval" },
    validation: "passed",
    url: "https://skills.sh/microsoft/skills/typescript",
    content: `# TypeScript 5 Guidelines

## Guidelines
- Enable \`strict: true\` and avoid \`any\` wherever possible; use \`unknown\` or generics.
- Leverage the \`satisfies\` operator for type checking while preserving literal types.
- Export clean public APIs with explicit return types on module boundaries.`,
  },
  {
    id: "rust",
    name: "Rust & Cargo",
    version: "1.80.0",
    description: "Idiomatic Rust, ownership patterns, error handling with anyhow/thiserror, and async tokio.",
    source: "skills.sh/rust-lang/rust",
    status: "installed",
    tags: ["rust", "cargo", "systems", "tokio"],
    requirements: ["rust"],
    permissions: { terminal: "approval" },
    validation: "passed",
    url: "https://skills.sh/rust-lang/skills/rust",
    content: `# Rust & Cargo Skill

## Guidelines
- Follow standard ownership and borrowing conventions without unnecessary \`.clone()\`.
- Use \`Result<T, E>\` and \`Option<T>\` idiomatic combinators (\`map\`, \`and_then\`, \`?\`).
- Run \`cargo clippy\` and \`cargo fmt\` to verify code correctness.`,
  },
  {
    id: "golang",
    name: "Go (Golang)",
    version: "1.23.0",
    description: "Idiomatic Go concurrency with goroutines and channels, context cancellation, and standard library.",
    source: "skills.sh/golang/go",
    status: "installed",
    tags: ["go", "golang", "backend", "concurrency"],
    requirements: ["go"],
    permissions: { terminal: "approval" },
    validation: "passed",
    url: "https://skills.sh/golang/skills/go",
    content: `# Go (Golang) Skill

## Guidelines
- Propagate \`context.Context\` explicitly through call stacks for timeout and cancellation control.
- Handle errors directly without ignoring returned error values.
- Keep package APIs small and focused.`,
  },
];

export const DEFAULT_SKILL_PACKS: SkillPack[] = [
  {
    id: "web-react-pack",
    name: "Web & React Pack",
    description: "Modern fullstack frontend engineering: Next.js 15, React 19, Tailwind CSS v4, and Shadcn UI.",
    author: "vercel-labs",
    url: "https://skills.sh/packs/web-react",
    installCommand: "npx skills add https://skills.sh/p/web-react",
    tags: ["react", "nextjs", "frontend", "tailwind"],
    skillCount: 4,
  },
  {
    id: "backend-db-pack",
    name: "Backend & Database Pack",
    description: "Postgres, Supabase RLS security, Prisma ORM modeling, and Cloudflare edge workers.",
    author: "supabase",
    url: "https://skills.sh/packs/backend-db",
    installCommand: "npx skills add https://skills.sh/p/backend-db",
    tags: ["database", "postgres", "backend", "supabase"],
    skillCount: 3,
  },
  {
    id: "testing-qa-pack",
    name: "Testing & Quality Pack",
    description: "Automated test suites: Vitest unit testing, Playwright E2E browser automation, and code QA.",
    author: "vitest-dev",
    url: "https://skills.sh/packs/testing-qa",
    installCommand: "npx skills add https://skills.sh/p/testing-qa",
    tags: ["testing", "vitest", "playwright", "qa"],
    skillCount: 2,
  },
  {
    id: "agent-workflows-pack",
    name: "Agent Workflows & Automation Pack",
    description: "CI/CD automation, GitHub Actions, Docker containerization, and agent protocols.",
    author: "actions",
    url: "https://skills.sh/packs/agent-workflows",
    installCommand: "npx skills add https://skills.sh/p/agent-workflows",
    tags: ["devops", "ci-cd", "docker", "automation"],
    skillCount: 2,
  },
  {
    id: "design-ui-pack",
    name: "Design & UI Pack",
    description: "Modern icon systems, UI micro-interactions, and WCAG 2.2 accessibility guidelines.",
    author: "lucide-icons",
    url: "https://skills.sh/packs/design-ui",
    installCommand: "npx skills add https://skills.sh/p/design-ui",
    tags: ["design", "icons", "a11y", "ui"],
    skillCount: 2,
  },
];
