import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Briefcase,
  Camera,
  Dumbbell,
  Folder,
  Heart,
  Lightbulb,
  Mail,
  Megaphone,
  ShoppingCart,
  Users,
  Video,
} from "lucide-react";

export type Hue =
  | "blue"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "purple"
  | "pink"
  | "brown"
  | "gray";

export type CategoryStyle = {
  Icon: LucideIcon;
  hue: Hue;
  /** CSS values for the hue - wash bg, soft border, accent + deep text. */
  wash: string;
  soft: string;
  accent: string;
  deep: string;
};

const HUE_VARS: Record<Hue, { wash: string; soft: string; accent: string; deep: string }> = {
  blue: { wash: "var(--color-nblue-100)", soft: "var(--color-nblue-200)", accent: "var(--color-nblue-500)", deep: "var(--color-nblue-700)" },
  red: { wash: "var(--color-nred-100)", soft: "var(--color-nred-200)", accent: "var(--color-nred-500)", deep: "var(--color-nred-700)" },
  orange: { wash: "var(--color-norange-100)", soft: "var(--color-norange-200)", accent: "var(--color-norange-500)", deep: "var(--color-norange-700)" },
  yellow: { wash: "var(--color-nyellow-100)", soft: "var(--color-nyellow-200)", accent: "var(--color-nyellow-500)", deep: "var(--color-nyellow-700)" },
  green: { wash: "var(--color-ngreen-100)", soft: "var(--color-ngreen-200)", accent: "var(--color-ngreen-500)", deep: "var(--color-ngreen-700)" },
  teal: { wash: "var(--color-nteal-100)", soft: "var(--color-nteal-200)", accent: "var(--color-nteal-500)", deep: "var(--color-nteal-700)" },
  purple: { wash: "var(--color-npurple-100)", soft: "var(--color-npurple-200)", accent: "var(--color-npurple-500)", deep: "var(--color-npurple-700)" },
  pink: { wash: "var(--color-npink-100)", soft: "var(--color-npink-200)", accent: "var(--color-npink-500)", deep: "var(--color-npink-700)" },
  brown: { wash: "var(--color-nbrown-100)", soft: "var(--color-nbrown-200)", accent: "var(--color-nbrown-500)", deep: "var(--color-nbrown-700)" },
  gray: { wash: "var(--color-ngray-100)", soft: "var(--color-ngray-300)", accent: "var(--color-ngray-500)", deep: "var(--color-ngray-700)" },
};

type Rule = { match: RegExp; Icon: LucideIcon; hue?: Hue };

// First matching rule wins. Icon always applies; hue may fall through to hash.
const RULES: Rule[] = [
  { match: /grocer|shopping/, Icon: ShoppingCart, hue: "green" },
  { match: /sermon|church|faith|bible/, Icon: BookOpen, hue: "purple" },
  { match: /marriage|wife|family/, Icon: Heart, hue: "pink" },
  { match: /gear|wishlist|equipment/, Icon: Camera, hue: "orange" },
  { match: /youtube/, Icon: Video, hue: "red" },
  { match: /tiktok|instagram|\big\b|social/, Icon: Megaphone, hue: "yellow" },
  { match: /email|newsletter/, Icon: Mail, hue: "teal" },
  { match: /health|fitness|gym|workout/, Icon: Dumbbell, hue: "teal" },
  { match: /content|video|idea/, Icon: Megaphone, hue: "red" },
  { match: /meeting/, Icon: Users },
  { match: /client|project|work/, Icon: Briefcase },
  { match: /general|note|learning/, Icon: Lightbulb, hue: "gray" },
];

const HASH_HUES: Hue[] = ["blue", "orange", "teal", "purple", "green", "pink", "brown", "yellow", "red"];

function hashHue(key: string): Hue {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return HASH_HUES[h % HASH_HUES.length];
}

/** Deterministic icon + Notion accent hue for a category. No stored config needed. */
export function categoryStyle(slugOrName: string, name?: string): CategoryStyle {
  const key = `${slugOrName} ${name ?? ""}`.toLowerCase();
  const rule = RULES.find((r) => r.match.test(key));
  const hue = rule?.hue ?? hashHue(slugOrName);
  return { Icon: rule?.Icon ?? Folder, hue, ...HUE_VARS[hue] };
}
