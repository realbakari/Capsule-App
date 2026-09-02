import type { CapsuleApi } from "../../preload/index";
import type { WebviewTag } from "electron";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<WebviewTag>, WebviewTag> & {
        src?: string;
        partition?: string;
        webpreferences?: string;
      };
    }
  }
}

declare global {
  interface Window {
    capsule: CapsuleApi;
  }
}

export {};
