"use client";

import { useEffect } from "react";
import { handleFormNavigationKeyDown, updateEnterKeyHints } from "@/lib/formNavigation";

export function FormEnterNavigator() {
  useEffect(() => {
    const refresh = () => updateEnterKeyHints();
    document.addEventListener("keydown", handleFormNavigationKeyDown, true);
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "readonly", "hidden", "aria-hidden", "data-enter-navigation", "class", "style"] });
    refresh();
    return () => {
      document.removeEventListener("keydown", handleFormNavigationKeyDown, true);
      observer.disconnect();
    };
  }, []);
  return null;
}
