# VoxVault Visual Design Philosophy

> "The Void" — A futuristic, minimalistic interface where content floats in darkness.

---

## Core Principles

1. **Maximum Negative Space** — Let the void breathe. Elements float, never crowd.
2. **Atmospheric Presence** — Subtle ambient effects create depth without distraction.
3. **Minimal Chrome** — Strip away unnecessary borders, shadows, and decorations.
4. **Glassmorphism Over Solid** — Surfaces are translucent, revealing layers beneath.

---

## Color Palette

### Foundation

| Token | Value | Usage |
|-------|-------|-------|
| `--void` | `#000000` | Pure black background |
| `--void-soft` | `#050508` | Elevated surfaces |
| `--surface` | `rgba(255,255,255,0.03)` | Interactive backgrounds |
| `--surface-hover` | `rgba(255,255,255,0.06)` | Hover states |
| `--glass` | `rgba(15,15,20,0.8)` | Glassmorphism panels |
| `--glass-border` | `rgba(255,255,255,0.08)` | Subtle borders |

### Text

| Token | Value | Usage |
|-------|-------|-------|
| `--text` | `#ffffff` | Primary text |
| `--text-secondary` | `rgba(255,255,255,0.6)` | Labels, descriptions |
| `--text-tertiary` | `rgba(255,255,255,0.35)` | Hints, placeholders |

### Accents

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#8b5cf6` | Electric violet — primary CTA, focus |
| `--accent-glow` | `rgba(139,92,246,0.5)` | Glow effects |
| `--accent-soft` | `rgba(139,92,246,0.15)` | Subtle highlights |
| `--cyan` | `#06b6d4` | Secondary accent |
| `--cyan-glow` | `rgba(6,182,212,0.4)` | Cyan glow |

### States

| Token | Value | Usage |
|-------|-------|-------|
| `--success` | `#10b981` | Confirmation, online |
| `--warning` | `#f59e0b` | Caution, pending |
| `--error` | `#ef4444` | Errors, recording, destructive |

---

## Typography

### Fonts

| Family | Weight | Usage |
|--------|--------|-------|
| **Sora** | 300–700 | Display text, body, buttons |
| **Space Mono** | 400, 700 | Labels, metadata, code-like elements |

### Import

```css
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
```

### Hierarchy

| Element | Font | Size | Weight | Spacing |
|---------|------|------|--------|---------|
| Brand name | Space Mono | 0.85rem | 700 | `letter-spacing: 0.2em` |
| Section labels | Space Mono | 0.75rem | 400 | `letter-spacing: 0.12em`, uppercase |
| Body text | Sora | 0.95rem | 400 | — |
| Buttons | Sora | 0.75–0.9rem | 500–600 | — |
| Meta/badges | Space Mono | 0.6–0.7rem | 400 | `letter-spacing: 0.1em`, uppercase |

---

## Layout

### Structure

```
┌─────────────────────────────────────────────────────┐
│  [Brand]                           [History Toggle] │  ← Floating header
│                                                     │
│           ╔═══════════════════════════╗             │
│           ║                           ║             │
│           ║    TRANSCRIPT HERO        ║             │  ← Central glass panel
│           ║    (main content)         ║             │
│           ║                           ║             │
│           ╚═══════════════════════════╝             │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ [Mode] │ [Input Panel] │ [Preview] │ [CTA]  │    │  ← Floating dock
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ○ ○ ○  (ambient orbs — background layer)          │
└─────────────────────────────────────────────────────┘
                                        ┌─────────────┐
                                        │ HISTORY     │  ← Slide-out panel
                                        │ PANEL       │
                                        │ (360px)     │
                                        └─────────────┘
```

### Key Components

| Component | Description |
|-----------|-------------|
| **Void container** | Full-viewport black background with 3 animated gradient orbs |
| **Brand mark** | Top-left floating logo + name |
| **History toggle** | Top-right button opens slide-out panel |
| **Transcript hero** | Central glassmorphism panel for main content |
| **Dock** | Bottom floating bar with mode switcher, inputs, preview, action |
| **History panel** | Right-side slide-out (360px) for past transcriptions |

### Spacing Scale

```css
--space-xs: 0.25rem;   /*  4px */
--space-sm: 0.5rem;    /*  8px */
--space-md: 1rem;      /* 16px */
--space-lg: 1.5rem;    /* 24px */
--space-xl: 2rem;      /* 32px */
--space-2xl: 3rem;     /* 48px */
```

### Border Radius

```css
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 20px;
--radius-xl: 28px;
```

---

## Effects

### Glassmorphism

```css
background: var(--glass);
border: 1px solid var(--glass-border);
backdrop-filter: blur(40px);
```

### Ambient Orbs

Three gradient blobs animate with `float` keyframes:
- **Orb 1**: Violet, 600px, top-left
- **Orb 2**: Cyan, 400px, bottom-right
- **Orb 3**: Pink, 300px, center-right (low opacity)

```css
@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25% { transform: translate(30px, -20px) scale(1.05); }
  50% { transform: translate(-20px, 30px) scale(0.95); }
  75% { transform: translate(20px, 20px) scale(1.02); }
}
```

### Transitions

Use `cubic-bezier(0.4, 0, 0.2, 1)` for smooth easing:

```css
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

---

## Accessibility

- Maintain WCAG 2.1 AA contrast for all text
- `--text` on `--void` = 21:1 ✓
- `--text-secondary` on `--void` ≈ 9:1 ✓
- Focus states use `--accent` with visible ring/glow
- Interactive elements have `:hover` and `:focus-visible` states

---

## Do's and Don'ts

### Do
- Use generous whitespace
- Keep animations subtle (< 0.5s, low movement)
- Use glassmorphism for floating panels
- Apply accent color sparingly for CTAs and focus
- Use Space Mono for technical/meta information

### Don't
- Add hard shadows
- Use solid colored containers
- Crowd elements together
- Use accent color for large areas
- Mix multiple bright accent colors

---

## Future Considerations

- Dark mode is the only mode (void-first)
- Consider reduced-motion media query for orb animations
- Maintain design tokens in CSS variables for easy theming
