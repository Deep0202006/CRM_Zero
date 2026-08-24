export const isTrackedPathOrDescendant = (trackedPaths, path) => trackedPaths.some((file) => file === path || file.startsWith(`${path}/`));
