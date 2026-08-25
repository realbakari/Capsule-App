import type { CapsuleApi } from "../../preload/index";

declare global {
  interface Window {
    capsule: CapsuleApi;
  }
}

export {};
