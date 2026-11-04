import { WidgetPlugin } from "./types";
import { mediaPlugin } from "../../modules/media";
import { audioPlugin } from "../../modules/audio";
import { toastsPlugin } from "../../modules/toasts";
import { dockerPlugin } from "../../modules/docker";
import { vpnPlugin } from "../../modules/vpn";
import { settingsPlugin } from "../../modules/settings";

export const pluginRegistry: WidgetPlugin[] = [
  mediaPlugin,
  audioPlugin,
  toastsPlugin,
  dockerPlugin,
  vpnPlugin,
  settingsPlugin,
];

export function getPluginById(id: string): WidgetPlugin | undefined {
  return pluginRegistry.find((p) => p.id === id);
}

export function getDefaultPlugin(): WidgetPlugin {
  return mediaPlugin;
}
