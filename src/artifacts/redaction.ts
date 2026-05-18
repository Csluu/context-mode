import { redactText } from "../filters/pipeline.js";

export interface ArtifactRedactionResult {
  readonly text: string;
  readonly counts: Record<string, number>;
}

export function redactArtifactText(text: string): ArtifactRedactionResult {
  return redactText(text);
}

