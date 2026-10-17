/** The parts of the Khronos glTF validator (`gltf-validator`, no bundled types) the E2E suite uses. */
declare module "gltf-validator" {
  export interface ValidationReport {
    issues: {
      numErrors: number;
      numWarnings: number;
      numInfos: number;
      messages: { code: string; message: string; severity: number; pointer?: string }[];
    };
  }
  export function validateBytes(data: Uint8Array, options?: { maxIssues?: number; ignoredIssues?: string[] }): Promise<ValidationReport>;
  export function version(): string;
}
