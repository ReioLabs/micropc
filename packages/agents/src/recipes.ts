import { MicroPcError } from "@micropc/core/errors.js";

export interface AgentRecipe {
  id: string;
  displayName: string;
  start(prompt?: string): string[];
  resume?(conversationId?: string): string[];
}

const recipes: AgentRecipe[] = [
  {
    id: "codex",
    displayName: "OpenAI Codex",
    start: (prompt) => (prompt ? ["codex", prompt] : ["codex"]),
    resume: (id) => (id ? ["codex", "resume", id] : ["codex", "resume", "--last"]),
  },
  {
    id: "claude",
    displayName: "Claude Code",
    start: (prompt) => (prompt ? ["claude", prompt] : ["claude"]),
    resume: (id) => (id ? ["claude", "--resume", id] : ["claude", "--continue"]),
  },
  {
    id: "droid",
    displayName: "Factory Droid",
    start: (prompt) => (prompt ? ["droid", prompt] : ["droid"]),
    resume: () => ["droid", "--resume"],
  },
  {
    id: "pi",
    displayName: "Pi",
    start: (prompt) => (prompt ? ["pi", prompt] : ["pi"]),
  },
];

export function getRecipe(id: string): AgentRecipe {
  const recipe = recipes.find((candidate) => candidate.id === id);
  if (!recipe)
    throw new MicroPcError(
      "UNKNOWN_AGENT_BACKEND",
      `Unknown backend '${id}'. Available: ${recipes.map((item) => item.id).join(", ")}`,
    );
  return recipe;
}

export function listRecipes(): Pick<AgentRecipe, "id" | "displayName">[] {
  return recipes.map(({ id, displayName }) => ({ id, displayName }));
}
