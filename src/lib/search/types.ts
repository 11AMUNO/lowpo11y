export type SearchResultKind =
  | "page"
  | "tool"
  | "asset"
  | "texture"
  | "collection"
  | "shader"
  | "starter"
  | "tutorial"
  | "creator"
  | "resource";

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle?: string;
  href: string;
  thumbnail?: string;
}
