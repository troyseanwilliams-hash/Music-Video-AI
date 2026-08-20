import { useEffect, useState } from "react";
import { Lightbulb, Sparkles, Mic2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";

type FillerKind = "prompt" | "fact" | "podcast";

type FillerItem = {
  kind: FillerKind;
  text: string;
};

const KIND_META: Record<FillerKind, { label: string; icon: typeof Lightbulb }> = {
  prompt: { label: "Prompt tip", icon: Lightbulb },
  fact: { label: "Fun fact", icon: Sparkles },
  podcast: { label: "While you wait", icon: Mic2 },
};

// A fixed, hand-picked rotation: mostly prompt tips and fun facts, with an
// occasional podcast cross-promo mixed in. This is the fallback waiting
// experience for older jobs that do not have a persisted storyboard.
const ROTATION: FillerItem[] = [
  { kind: "prompt", text: "Naming a camera move — “slow dolly in”, “sweeping drone shot” — gives your clips cinematic energy." },
  { kind: "fact", text: "Standard film runs at 24 frames per second — every clip you're generating is built from hundreds of individual frames." },
  { kind: "prompt", text: "A color palette like “neon teal and magenta” keeps every generated clip visually consistent." },
  { kind: "fact", text: "The word “storyboard” comes from Walt Disney's animation studio in the 1930s." },
  { kind: "podcast", text: "Got something to say out loud too? AIPodSync turns a script or recording into a narrated, auto-captioned episode — aipodsync.com" },
  { kind: "prompt", text: "Mentioning a time of day — “golden hour”, “blue hour”, “neon night” — keeps lighting consistent across clips." },
  { kind: "fact", text: "“Video Killed the Radio Star” was the first music video ever aired on MTV, back in 1981." },
  { kind: "prompt", text: "Describing an era or film stock — “shot on 16mm, 1970s” — changes the whole mood of a scene." },
  { kind: "fact", text: "Silent films dominated cinema for over three decades before synchronized sound became standard in the late 1920s." },
  { kind: "podcast", text: "Building a podcast to go with this video? AIPodSync handles narration, mixing, and clip highlights automatically — aipodsync.com" },
  { kind: "prompt", text: "Pairing an emotion with an action — “triumphant, sprinting through rain” — reads stronger than either alone." },
  { kind: "fact", text: "The term “movie” comes from “moving picture” — an illusion created by flashing still frames in quick succession." },
  { kind: "prompt", text: "Want exact words on screen — a title or CTA? Use the Captions section on the Generate page instead of typing them into the prompt: it burns real text, so it never comes out garbled the way AI-drawn text can." },
];

const ROTATE_MS = 5500;

/**
 * Rotating filler content (prompt tips, fun facts, and the occasional
 * podcast hint) shown while an active generation has no stored storyboard.
 */
export default function GenerationFiller() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % ROTATION.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const current = ROTATION[index];
  const { label, icon: Icon } = KIND_META[current.kind];

  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex flex-col items-center text-center gap-3 min-h-[120px] justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35 }}
              className="flex flex-col items-center gap-3 max-w-xl"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </span>
              <p className="text-sm text-muted-foreground">{current.text}</p>
            </motion.div>
          </AnimatePresence>
          <div className="flex items-center gap-1.5 pt-1">
            {ROTATION.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i === index ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
