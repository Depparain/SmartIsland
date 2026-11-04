import { Music } from "lucide-react";
import { WidgetPlugin } from "../../core/plugins/types";
import { MediaWidget } from "./MediaWidget";

export const mediaPlugin: WidgetPlugin = {
  id: "media",
  nameKey: "tabs.media",
  defaultLabel: "Media",
  icon: Music,
  defaultEnabled: true,
  order: 10,
  dimensions: {
    width: 460,
    height: 200,
  },
  component: MediaWidget,
};
