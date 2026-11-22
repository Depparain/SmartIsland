import { Volume2 } from "lucide-react";
import { WidgetPlugin } from "../../core/plugins/types";
import { AudioWidget } from "./AudioWidget";

export const audioPlugin: WidgetPlugin = {
  id: "audio",
  nameKey: "tabs.audio",
  defaultLabel: "Audio",
  icon: Volume2,
  defaultEnabled: true,
  order: 20,
  dimensions: {
    width: 460,
    height: 250,
  },
  component: AudioWidget,
};
