"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  CircleXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="text-tone-ok size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="text-tone-warn size-4" />,
        error: <CircleXIcon className="text-tone-bad size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !bg-card !text-card-foreground !border-border !border !shadow-lg",
          title: "!text-sm !font-medium",
          description: "!text-[13px] !text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
