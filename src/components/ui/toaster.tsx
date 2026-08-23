"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * App-wide toast host. Styling is bound to the design tokens rather than
 * Sonner's defaults so toasts read as part of the product.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      offset={16}
      // Sits above the mobile bottom nav rather than under it.
      mobileOffset={{ bottom: 88, left: 12, right: 12 }}
      toastOptions={{
        classNames: {
          toast:
            "!bg-surface-raised !text-ink !border-line !rounded-2xl !shadow-2xl !shadow-black/50 !font-sans",
          title: "!font-display !font-semibold",
          description: "!text-ink-muted",
          actionButton: "!bg-primary !text-on-primary",
          cancelButton: "!bg-surface-overlay !text-ink-muted",
          success: "!border-success/40",
          error: "!border-danger/40",
        },
      }}
    />
  );
}

export { toast } from "sonner";
