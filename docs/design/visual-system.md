# Visual design specification

Brand: Nodexxa. Modern professional infrastructure observability dashboard. Restrained blue/indigo primary, neutral surfaces, clear status semantics; no decorative giant gradients, no green page background, no emojis as production icons. Use Nuxt UI theme tokens and accessible Lucide-style iconography.

Mandatory theme modes: **Light**, **Dark**, **System**. Visible theme control in header and settings. System mode follows OS preference; manual selection saved per authenticated user with local fallback for pre-login. Hydration-safe to prevent flash of wrong theme. Use accessible contrast and do not encode health solely as color. All screens—tables, popovers, forms, charts, code snippets, loading states and alert badges—must be tested in both modes. Respect reduced-motion preferences. Dense but readable desktop tables and genuinely responsive mobile layouts.

Navigation and information architecture: fixed sidebar on desktop, compact mobile navigation, workspace/client filter visible, search and quick filters. Unavailable data shown explicitly, never as zero. Prefer polished functional tables over vanity charts.
