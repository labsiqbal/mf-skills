---
name: mf-design
description: Create distinct HTML design directions and a comparison page, then tune a chosen direction through a live panel with exportable CSS. Use for web design exploration or resuming its selection and tuning, rather than ordinary single-page polish.
license: MIT
metadata:
  version: "0.1.1"
  status: draft
  author: labsiqbal
---

# mf-design

Turn one brief into runnable HTML alternatives, then refine the user's choice. Resume the existing phase when alternatives or a selection already exist; keep manual edits. Default to standalone HTML/CSS/JS inside the project's artifact area. An existing application keeps its stack and production entrypoint.

## Workflow

1. **Bind brief.** Identify target page, audience, primary action, required content, assets, viewport, and existing project entrypoint. Inspect current HTML/CSS and assets before writing. Ask only for missing facts that change the direction or file target.
2. **Set visual world.** Use available design guidance, such as `impeccable`, `make-interfaces-feel-better`, or `mf-copywriting`, when relevant and permitted by the harness. These are optional companions. Without them, choose a coherent composition, type hierarchy, palette, and image treatment from the brief; check responsive layout, contrast, focus, and factual copy directly. Preserve factual copy, product behavior, and supplied assets unless the user asks for changes.
3. **Create directions.** Make three distinct, complete directions by default. Give each a clear point of view: change composition, type hierarchy, color/material, image treatment, and interaction emphasis. Each direction must differ on at least two of those dimensions beyond palette. Keep content, primary action, and page scope comparable. Deliver the complete agreed page with working local assets and honest interactions; invent no product claims or metrics. Isolate each direction's styles.
4. **Create comparison.** Add a lightweight comparison page or route that shows each direction at the target viewport, names its design idea, and links to its full page. Include a short tradeoff note for each direction. Include desktop/mobile viewport controls and a direct link for each option. Keep comparison scaffolding separate from production entrypoints. Use the harness's supported preview when available. Otherwise provide files and instructions for opening the comparison in a browser; ask the user to choose after viewing it. Browser control follows the active harness rules; report unavailable checks without switching models or exposing a server.
5. **Pause for choice.** Present the directions and ask which one to continue, or accept a mix such as “layout 2, type 1, imagery 3”. Do not silently collapse variants into one before the choice.
6. **Tune selected direction.** Move repeated visual controls into CSS custom properties. When live tuning is requested, add a dev-only panel that edits those properties in place: colors, type scale, spacing, content width, radii, shadows, image treatment, and motion intensity. Keep semantic markup and component structure in source. Include Reset and Export/Copy CSS controls. Export valid CSS containing the current allowlisted tokens, ready for source use. Optional temporary storage must be namespaced per direction and validate values on load. Browser storage persists a preview, not the source file; say which was saved. Keep the panel from covering content on mobile.
7. **Export the result.** When the user asks to save or finalize, apply chosen values to the page's normal stylesheet and check a fresh load without stored overrides. Preserve unselected alternatives. New layout or content revisions use targeted source edits through chat. Remove dev-only controls when the user asks for production output, or keep them clearly gated behind the project's existing development convention.

## Tuning rules

- Use native HTML, CSS, and small vanilla JavaScript before adding a dependency. Do not introduce a framework or editor for a tweak panel.
- Make controls keyboard reachable, labeled, and usable at narrow widths. Honor `prefers-reduced-motion`.
- Keep CSS variables as the single source of truth for values exposed in the panel. Define defaults once; controls read token values instead of maintaining a second hardcoded style map.
- Use safe bounds and readable labels for numeric controls. Preserve contrast and focus states when colors change.
- Treat drag-and-drop as a separate feature. Add it only when explicitly requested; token tuning covers the default workflow.

## Completion

Exploration ends with the requested number of complete directions, working comparison links, and a visible choice awaiting the user. Tuning ends with working controls and CSS export; finalization ends with source containing the chosen values. Verify the changed phase at desktop/mobile sizes, including keyboard controls and export/reset behavior, using available authorized tools and project checks. If an available design skill provides a scoped review, use it; otherwise review hierarchy, spacing, contrast, focus, and narrow layouts directly. Report source paths, saved-versus-preview state, and any checks unavailable.
