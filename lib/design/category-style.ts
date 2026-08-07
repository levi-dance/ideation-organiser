import type { LucideIcon } from "lucide-react";
import {
  Blocks,
  BookOpen,
  Briefcase,
  Camera,
  Code,
  Compass,
  Dumbbell,
  Folder,
  Heart,
  Home,
  Lightbulb,
  Mail,
  Map,
  Megaphone,
  Mic,
  Music,
  Palette,
  PenLine,
  PiggyBank,
  Plane,
  ShoppingCart,
  Sprout,
  Users,
  Utensils,
  Video,
  Wrench,
} from "lucide-react";

/**
 * The icons a category may be given in Settings. Keyed by a stable name that is
 * what gets stored, so the database never holds a component reference and an
 * unknown value can always fall back rather than crash a render.
 */
export const ICON_POOL: Record<string, LucideIcon> = {
  folder: Folder,
  lightbulb: Lightbulb,
  pen: PenLine,
  book: BookOpen,
  briefcase: Briefcase,
  users: Users,
  megaphone: Megaphone,
  video: Video,
  mic: Mic,
  camera: Camera,
  music: Music,
  palette: Palette,
  code: Code,
  blocks: Blocks,
  wrench: Wrench,
  mail: Mail,
  cart: ShoppingCart,
  utensils: Utensils,
  dumbbell: Dumbbell,
  heart: Heart,
  home: Home,
  sprout: Sprout,
  piggybank: PiggyBank,
  plane: Plane,
  map: Map,
  compass: Compass,
};

export type IconName = keyof typeof ICON_POOL;

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

/**
 * Sensible defaults so a brand-new install looks right before anyone has
 * configured anything. First matching rule wins; the icon always applies, the
 * hue may fall through to the hash.
 *
 * These are deliberately generic life and work areas, not one person's. Anyone
 * whose category does not match gets a folder in a hashed colour, and any
 * category can be given an explicit icon and colour in Settings, which is what
 * this whole list is only a fallback for.
 */
const RULES: Rule[] = [
  { match: /grocer|shopping|errand/, Icon: ShoppingCart, hue: "green" },
  { match: /recipe|cook|food|meal/, Icon: Utensils, hue: "orange" },
  { match: /writing|draft|essay|article|book|read/, Icon: BookOpen, hue: "purple" },
  { match: /family|home|personal/, Icon: Home, hue: "pink" },
  { match: /gear|wishlist|equipment/, Icon: Camera, hue: "orange" },
  { match: /youtube/, Icon: Video, hue: "red" },
  { match: /tiktok|instagram|\big\b|social/, Icon: Megaphone, hue: "yellow" },
  { match: /podcast|audio|music/, Icon: Mic, hue: "purple" },
  { match: /email|newsletter/, Icon: Mail, hue: "teal" },
  { match: /health|fitness|gym|workout|training/, Icon: Dumbbell, hue: "teal" },
  { match: /money|budget|finance|invoice/, Icon: PiggyBank, hue: "green" },
  { match: /travel|trip|holiday/, Icon: Plane, hue: "blue" },
  { match: /garden|plant|outdoor/, Icon: Sprout, hue: "green" },
  { match: /code|dev|engineering|software/, Icon: Code, hue: "blue" },
  { match: /design|brand|visual/, Icon: Palette, hue: "pink" },
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

export const HUES: Hue[] = [
  "blue",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "purple",
  "pink",
  "brown",
  "gray",
];

/** What a category may store to override the keyword defaults. Either may be null. */
export type StyleOverride = { icon?: string | null; hue?: string | null };

function isHue(value: unknown): value is Hue {
  return typeof value === "string" && (HUES as string[]).includes(value);
}

/**
 * Icon + Notion accent hue for a category: whatever was chosen in Settings,
 * otherwise a keyword guess from the name, otherwise a folder in a hashed
 * colour. An override naming an icon this build does not have falls through to
 * the guess rather than rendering nothing.
 */
export function categoryStyle(
  slugOrName: string,
  name?: string,
  override?: StyleOverride
): CategoryStyle {
  const key = `${slugOrName} ${name ?? ""}`.toLowerCase();
  const rule = RULES.find((r) => r.match.test(key));
  const chosenIcon = override?.icon ? ICON_POOL[override.icon] : undefined;
  const hue = isHue(override?.hue) ? override.hue : (rule?.hue ?? hashHue(slugOrName));
  return { Icon: chosenIcon ?? rule?.Icon ?? Folder, hue, ...HUE_VARS[hue] };
}
