import type { DocumentFontPreset, DocumentFontSettings, DocumentFontWeight } from "./formatTypes";

export type TableStyle = "standard" | "three-line";

export type ApplicationAppearanceSettings = {
  version: 1;
  font: DocumentFontSettings;
  tableStyle: TableStyle;
  firstLineIndent: boolean;
};

const storageKey = "hakurou.application-appearance";
const defaultFont: DocumentFontSettings = { preset: "standard", weight: 400 };

export function defaultApplicationAppearance(): ApplicationAppearanceSettings {
  return { version: 1, font: { ...defaultFont }, tableStyle: "standard", firstLineIndent: false };
}

export function readApplicationAppearance(): ApplicationAppearanceSettings {
  try {
    return parseApplicationAppearance(JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"));
  } catch {
    return defaultApplicationAppearance();
  }
}

export function writeApplicationAppearance(settings: ApplicationAppearanceSettings) {
  window.localStorage.setItem(storageKey, JSON.stringify(settings));
}

export function fontForPreset(preset: Exclude<DocumentFontPreset, "custom">, weight: DocumentFontWeight = 400): DocumentFontSettings {
  return { preset, weight };
}

export function fontFamilyStack(font: DocumentFontSettings) {
  if (font.preset === "modern") return 'Inter, "HarmonyOS Sans SC", "HarmonyOS Sans", "Microsoft YaHei UI", sans-serif';
  if (font.preset === "standard") return '"Times New Roman", SimSun, "Songti SC", serif';
  if (font.preset === "custom") {
    const latin = safeFontFamily(font.latinFamily) || "Georgia";
    const chinese = safeFontFamily(font.chineseFamily) || '"Noto Serif SC"';
    return `${latin}, ${chinese}, serif`;
  }
  return 'Georgia, "Noto Serif SC", "Songti SC", serif';
}

export function fontFamiliesForInput(font: DocumentFontSettings) {
  if (font.preset === "modern") return { chinese: "HarmonyOS Sans", latin: "Inter" };
  if (font.preset === "standard") return { chinese: "SimSun", latin: "Times New Roman" };
  if (font.preset === "custom") return {
    chinese: font.chineseFamily || "Noto Serif SC",
    latin: font.latinFamily || "Georgia",
  };
  return { chinese: "Noto Serif SC", latin: "Georgia" };
}

function parseApplicationAppearance(value: unknown): ApplicationAppearanceSettings {
  const settings = value as Partial<ApplicationAppearanceSettings> | null;
  const font = parseFont(settings?.font);
  return {
    version: 1,
    font: font ?? { ...defaultFont },
    tableStyle: settings?.tableStyle === "three-line" ? "three-line" : "standard",
    firstLineIndent: Boolean(settings?.firstLineIndent),
  };
}

function parseFont(value: unknown): DocumentFontSettings | null {
  const font = value as Partial<DocumentFontSettings> | null;
  if (!font || typeof font !== "object") return null;
  if (font.preset !== "elegant" && font.preset !== "modern" && font.preset !== "standard" && font.preset !== "custom") return null;
  if (font.weight !== 300 && font.weight !== 400 && font.weight !== 500 && font.weight !== 600 && font.weight !== 700) return null;
  const chineseFamily = normalizeFontFamily(font.chineseFamily);
  const latinFamily = normalizeFontFamily(font.latinFamily);
  if (font.preset === "custom" && !chineseFamily && !latinFamily) return null;
  return {
    preset: font.preset,
    weight: font.weight,
    ...(chineseFamily ? { chineseFamily } : {}),
    ...(latinFamily ? { latinFamily } : {}),
  };
}

function normalizeFontFamily(value: unknown) {
  return typeof value === "string" ? value.replace(/[;{}]/g, "").trim().slice(0, 120) : "";
}

function safeFontFamily(value: string | undefined) {
  const normalized = normalizeFontFamily(value);
  return normalized ? `"${normalized.replace(/"/g, "\\\"")}"` : "";
}
