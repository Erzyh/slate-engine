import { emptyCartridge, type Cartridge } from "@slate/runtime";
import jelly from "../../../games/jelly/build/jelly-jump.slate?raw";
import starBarrage from "../../../games/star-barrage/build/star-barrage.slate?raw";
import platformer from "../../../templates/platformer/build/platformer.slate?raw";
import topdown from "../../../templates/topdown/build/topdown.slate?raw";
import shmup from "../../../templates/shmup/build/shmup.slate?raw";

const TEMPLATES: Record<string, string> = { platformer, topdown, shmup };

/** A starter project (templates/NAME), or null for an unknown name. */
export function template(id: string): Cartridge | null {
  return id in TEMPLATES ? JSON.parse(TEMPLATES[id]) : null;
}

export function example(id: string): Cartridge {
  if (id === "jelly") return JSON.parse(jelly);
  if (id === "star-barrage") return JSON.parse(starBarrage);
  return emptyCartridge();
}
