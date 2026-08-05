/** Deep research output mode (notes, report, comparison, learning path). */
export type ResearchMode =
  | ""
  | "notes"
  | "report"
  | "comparison"
  | "learning_path";
/** Research depth level (quick, standard, deep, or manual). */
export type ResearchDepth = "" | "quick" | "standard" | "deep" | "manual";

/** A single outline item with title and overview. */
export interface OutlineItem {
  title: string;
  overview: string;
}

/** Form configuration for the deep_research capability. */
export interface DeepResearchFormConfig {
  mode: ResearchMode;
  depth: ResearchDepth;
  manual_subtopics?: number;
  manual_max_iterations?: number;
  confirmed_outline?: OutlineItem[];
}

/** Result of validating a research config (valid flag + per-field errors). */
export interface ResearchConfigValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/** Create an empty research config with default mode and depth.
 * @returns A fresh DeepResearchFormConfig with empty mode and depth. */
export function createEmptyResearchConfig(): DeepResearchFormConfig {
  return {
    mode: "",
    depth: "",
  };
}

/** Normalize a raw config object into a valid DeepResearchFormConfig.
 * @param raw - Untrusted config object (or undefined).
 * @returns Config with validated mode and depth (defaults for invalid values). */
export function normalizeResearchConfig(
  raw: Record<string, unknown> | undefined,
): DeepResearchFormConfig {
  const empty = createEmptyResearchConfig();
  return {
    mode:
      raw?.mode === "notes" ||
      raw?.mode === "report" ||
      raw?.mode === "comparison" ||
      raw?.mode === "learning_path"
        ? raw.mode
        : empty.mode,
    depth:
      raw?.depth === "quick" ||
      raw?.depth === "standard" ||
      raw?.depth === "deep" ||
      raw?.depth === "manual"
        ? raw.depth
        : empty.depth,
  };
}

/** Validate that a research config has required mode and depth.
 * @param cfg - The config to validate.
 * @returns Validation result with per-field error messages. */
export function validateResearchConfig(
  cfg: DeepResearchFormConfig,
): ResearchConfigValidationResult {
  const errors: Record<string, string> = {};

  if (!cfg.mode) {
    errors.mode = "Required";
  }
  if (!cfg.depth) {
    errors.depth = "Required";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Build the WebSocket config payload for a deep research request.
 * @param cfg - The validated research form config.
 * @param confirmedOutline - Optional confirmed outline items.
 * @returns Config object for the WS start_turn message.
 * @throws Error if the config is incomplete. */
export function buildResearchWSConfig(
  cfg: DeepResearchFormConfig,
  confirmedOutline?: OutlineItem[],
): Record<string, unknown> {
  const validation = validateResearchConfig(cfg);
  if (!validation.valid) {
    throw new Error("Deep research settings are incomplete.");
  }

  const result: Record<string, unknown> = {
    mode: cfg.mode,
    depth: cfg.depth,
  };

  if (cfg.depth === "manual") {
    if (cfg.manual_subtopics != null)
      result.manual_subtopics = cfg.manual_subtopics;
    if (cfg.manual_max_iterations != null)
      result.manual_max_iterations = cfg.manual_max_iterations;
  }

  const outline = confirmedOutline ?? cfg.confirmed_outline;
  if (outline && outline.length > 0) {
    result.confirmed_outline = outline;
  }

  return result;
}

const RESEARCH_MODE_LABELS: Record<string, string> = {
  notes: "Study Notes",
  report: "Report",
  comparison: "Comparison",
  learning_path: "Learning Path",
};

const RESEARCH_DEPTH_LABELS: Record<string, string> = {
  quick: "Quick",
  standard: "Standard",
  deep: "Deep",
  manual: "Manual",
};

/** One-line summary of the research config for the collapsed settings chevron.
 * @param cfg - The research form config.
 * @param translate - Optional i18n translate function.
 * @returns Human-readable summary string (e.g. "Study Notes · Deep"). */
export function summarizeResearchConfig(
  cfg: DeepResearchFormConfig,
  translate?: (key: string) => string,
): string {
  const validation = validateResearchConfig(cfg);
  const tr = translate ?? ((s: string) => s);
  if (!validation.valid) return tr("Incomplete settings");
  const modeLabel =
    RESEARCH_MODE_LABELS[cfg.mode] ?? cfg.mode.replace("_", " ");
  const depthLabel = RESEARCH_DEPTH_LABELS[cfg.depth] ?? cfg.depth;
  return [tr(modeLabel), tr(depthLabel)].join(" · ");
}
