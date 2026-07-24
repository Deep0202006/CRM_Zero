# Target Login Layout

## Strategy for 320px Viewport (No Scroll)

1. **Mobile Layout (Default)**:
   - The main container will be a flex column `min-h-[100svh]`.
   - The logo and introductory text will take minimal space at the top.
   - The login form will occupy the center of the screen, completely visible above the fold.
   - The marketing/informational content will either be hidden on mobile or pushed to a secondary section below the fold that users can scroll to *if they want to*, but logging in requires no scrolling.

2. **Desktop Layout (`lg`)**:
   - Maintain the two-column grid structure (informational left, form right).
   - Ensure the form remains centered vertically.

3. **Motion**:
   - Keep the `animate-logo-reveal` but reduce the timeout significantly, or use a faster CSS-only keyframe animation.
   - Ensure `prefers-reduced-motion` is strictly respected.
