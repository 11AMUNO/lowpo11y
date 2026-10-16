export interface EditorAsset {
  id: string;
  slug: string;
  title: string;
  assetType: string;
  status: "draft" | "review" | "published" | "archived";
  shortDescription: string;
  descriptionMd: string;
  usageNotesMd: string;
  categoryId: string | null;
  licenceId: string | null;
  attributionText: string | null;
  licenceSourceUrl: string | null;
  provenanceKind: string | null;
  provenanceNotes: string | null;
  featured: boolean;
  engines: string[];
  tags: string[];
  attestedAt: string | null;
  attestedBy: string | null;
  isDemo: boolean;
  publicPath: string | null;
}

export interface EditorFile {
  id: string;
  purpose: string;
  filename: string;
  format: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  triangles: number | null;
  sizeVariant: number | null;
  generated: string | null;
  note: string | null;
  isPrimary: boolean;
  published: boolean;
  isPublic: boolean;
}

export interface Option {
  id: string;
  label: string;
  hint?: string;
}

export interface ChecklistRow {
  id: string;
  label: string;
  ok: boolean;
  blocking: boolean;
}
