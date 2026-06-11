import { lazy, Suspense } from "react";

// Lazy-load emoji-picker-react so it is NOT in the main inbox bundle.
// Loaded only when the user opens the emoji popover.
const EmojiPicker = lazy(() => import("emoji-picker-react"));

export type LazyEmojiPickerProps = {
  onSelect: (emoji: string) => void;
};

export function LazyEmojiPicker({ onSelect }: LazyEmojiPickerProps) {
  return (
    <Suspense
      fallback={
        <div
          style={{ width: 350, height: 400 }}
          className="flex items-center justify-center text-xs text-[color:var(--ww-text-muted)]"
        >
          Carregando emojis…
        </div>
      }
    >
      <EmojiPicker
        onEmojiClick={(data: { emoji: string }) => onSelect(data.emoji)}
        theme={"dark" as never}
        emojiStyle={"native" as never}
        width={350}
        height={400}
        lazyLoadEmojis
        searchPlaceholder="Buscar emoji"
        previewConfig={{ showPreview: false }}
        skinTonesDisabled={false}
      />
    </Suspense>
  );
}
