# Current Login Audit

## Issues Against Constraints
1. **Viewport Visibility**: The login form is currently pushed below the fold on mobile devices because the marketing section (left column on desktop) stacks on top of it.
2. **Horizontal Overflow**: Potential issues at 320px due to padding and fixed widths on some text containers.
3. **Motion**: Uses an intro splash screen that takes 1720ms, which may feel slow.

## Required Changes
- Reverse the flex/grid stacking order on mobile, or hide the marketing section completely on mobile so the form is front and center.
- Optimize the intro animation latency to make it feel premium but fast.
- Ensure all input fields and buttons fit comfortably within a 320px width limit.
